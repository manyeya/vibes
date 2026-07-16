import type { ModelMessage } from 'ai';
import {
    PluginStreamContext,
    type DataStreamWriter,
} from '../core/types';
import type { VibesPlugin } from '../core/agent/plugin-api';
import { redactString } from '../core/redact';

export type GuardrailStage = 'input' | 'output';

/**
 * Outcome of a guardrail check:
 *  - 'pass'   → allow unchanged
 *  - block    → halt the run (input) / flag the output, with a reason
 *  - redact   → continue with the rewritten text
 */
export type GuardrailResult =
    | 'pass'
    | { action: 'block'; message: string }
    | { action: 'redact'; text: string };

export interface GuardrailContext {
    stage: GuardrailStage;
}

export interface Guardrail {
    name: string;
    stage: GuardrailStage;
    check: (text: string, ctx: GuardrailContext) => GuardrailResult | Promise<GuardrailResult>;
}

/** Thrown when an input guardrail blocks a run. Halts the loop; surfaced to the UI. */
export class GuardrailError extends Error {
    constructor(public readonly guardrail: string, message: string) {
        super(message);
        this.name = 'GuardrailError';
    }
}

export interface GuardrailsConfig {
    /** Caller-supplied guardrails (input and/or output). */
    guardrails?: Guardrail[];
    /**
     * Add the built-in secret-masking guardrail on input + output prose
     * (default true). Tool I/O is masked separately at the tool-execute layer;
     * this catches secrets in the user's message or the model's own prose.
     */
    maskSecrets?: boolean;
}

const secretMaskGuardrail = (stage: GuardrailStage): Guardrail => ({
    name: 'secret-mask',
    stage,
    check: (text) => {
        const redacted = redactString(text);
        return redacted === text ? 'pass' : { action: 'redact', text: redacted };
    },
});

/** Extract the plain text of a model message (content is a string or parts array). */
function messageText(message: ModelMessage | undefined): string {
    if (!message) return '';
    const content = message.content as unknown;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text ?? '') : ''))
            .join('');
    }
    return '';
}

/** Replace a message's text content, preserving everything else. */
function withText(message: ModelMessage, text: string): ModelMessage {
    if (typeof message.content === 'string') {
        return { ...message, content: text } as ModelMessage;
    }
    // Collapse parts to a single text part — guardrails only touch text.
    return { ...message, content: [{ type: 'text', text }] } as ModelMessage;
}

/**
 * Input/output content guardrails (pydantic-ai-shields parity). Input guardrails
 * run before the first model call via `prepareTurn` and can block (throw) or
 * redact (rewrite the message — a supported v7 `prepareTurn` message override).
 * Output guardrails run after the run completes via `onStreamFinish` and flag
 * violations as a notice (the text is already streamed, so this is post-hoc —
 * see ponytail note below).
 */
export default class GuardrailsPlugin implements VibesPlugin {
    name = 'GuardrailsPlugin';
    private writer?: DataStreamWriter;
    private inputGuards: Guardrail[];
    private outputGuards: Guardrail[];

    constructor(config: GuardrailsConfig = {}) {
        const guards = [...(config.guardrails ?? [])];
        if (config.maskSecrets ?? true) {
            guards.push(secretMaskGuardrail('input'), secretMaskGuardrail('output'));
        }
        this.inputGuards = guards.filter((g) => g.stage === 'input');
        this.outputGuards = guards.filter((g) => g.stage === 'output');
    }

    onStreamContextReady(context: PluginStreamContext) {
        this.writer = context.writer.withDefaults({ plugin: this.name });
    }

    /** Input guardrails: gate the fresh user turn (step 0) only. */
    async prepareTurn(options: { stepNumber: number; messages: ModelMessage[] }) {
        if (options.stepNumber !== 0 || this.inputGuards.length === 0) return;
        const messages = options.messages;
        // The user's turn is the last user message in the list.
        const idx = findLastIndex(messages, (m) => m.role === 'user');
        if (idx < 0) return;

        let text = messageText(messages[idx]);
        let changed = false;

        // ponytail: sequential so redactions compose (each guard sees the prior
        // guard's output); parallelize with Promise.all if guard latency dominates.
        for (const guard of this.inputGuards) {
            const result = await guard.check(text, { stage: 'input' });
            if (result === 'pass') continue;
            if (result.action === 'block') {
                this.emit('input', guard.name, 'blocked', result.message);
                throw new GuardrailError(guard.name, result.message);
            }
            // redact
            if (result.text !== text) {
                text = result.text;
                changed = true;
                this.emit('input', guard.name, 'redacted', 'Redacted sensitive content from your message.');
            }
        }

        if (!changed) return;
        const next = messages.slice();
        next[idx] = withText(messages[idx], text);
        return { messages: next };
    }

    /** Output guardrails: validate the final assistant text after the run. */
    async onStreamFinish(result: unknown) {
        if (this.outputGuards.length === 0) return;
        const text = assistantText(result);
        if (!text) return;
        for (const guard of this.outputGuards) {
            const out = await guard.check(text, { stage: 'output' });
            if (out === 'pass') continue;
            // ponytail: streamed output is already sent, so output guardrails
            // flag post-hoc rather than un-send. Upgrade path: v7
            // experimental_transform (StreamTextTransform) for mid-stream redaction.
            if (out.action === 'block') {
                this.emit('output', guard.name, 'blocked', out.message);
            } else if (out.text !== text) {
                this.emit('output', guard.name, 'redacted', 'The response contained sensitive content.');
            }
        }
    }

    private emit(stage: GuardrailStage, guardrail: string, action: 'blocked' | 'redacted', message: string) {
        this.writer?.writeGuardrail({
            id: `${stage}-${guardrail}-${Date.now().toString(36)}`,
            stage,
            guardrail,
            action,
            message,
        });
    }
}

/** Assistant text from a stream-finish response (response.messages or .content). */
function assistantText(result: unknown): string {
    if (!result || typeof result !== 'object') return '';
    const r = result as { messages?: ModelMessage[]; content?: unknown; text?: string };
    if (typeof r.text === 'string') return r.text;
    if (Array.isArray(r.messages)) {
        return r.messages
            .filter((m) => m.role === 'assistant')
            .map((m) => messageText(m))
            .join('\n');
    }
    return '';
}

/** Array.prototype.findLastIndex isn't on the lib target everywhere; tiny local. */
function findLastIndex<T>(arr: T[], pred: (item: T) => boolean): number {
    for (let i = arr.length - 1; i >= 0; i--) {
        if (pred(arr[i])) return i;
    }
    return -1;
}
