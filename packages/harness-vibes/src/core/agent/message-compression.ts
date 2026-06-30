/**
 * Message inspection + restorable compression helpers.
 *
 * Pure functions over `ModelMessage`s — no agent state — used by AgentHarness's
 * pruning pipeline. The guiding principle is that compression is LOSSLESS and
 * RESTORABLE: large tool outputs are shrunk to a reference + preview (the full
 * result is one re-run away), message structure is preserved (a tool-result
 * keeps its `toolCallId`/`toolName` so the provider's tool-call ↔ tool-result
 * pairing stays intact), and errors are never compressed.
 */

import type { ModelMessage } from 'ai';

/** Tool call arguments with known properties. */
export interface ToolCallArgs {
    path?: string;
    command?: string;
    [key: string]: unknown;
}

/**
 * Pull the textual payload out of a tool-result part across AI SDK output
 * shapes ({ type:'text'|'json'|'error-text'|..., value }, or a legacy string).
 */
export function toolResultText(part: unknown): string {
    const out = (part as { output?: unknown })?.output;
    if (out == null) return '';
    if (typeof out === 'string') return out;
    const value = (out as { value?: unknown }).value;
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value ?? out);
    } catch {
        return String(value ?? '');
    }
}

/** Extract message content as a string for size/error analysis. */
export function extractMessageContent(msg: ModelMessage): string {
    if (typeof msg.content === 'string') {
        return msg.content;
    }
    if (Array.isArray(msg.content)) {
        return msg.content
            .map(part => {
                if (part.type === 'text') return part.text;
                if (part.type === 'tool-call') {
                    const tc = part as { toolName?: string; args?: unknown; input?: unknown };
                    const rawArgs = tc.args ?? tc.input;
                    const argsStr = rawArgs ? JSON.stringify(rawArgs).slice(0, 200) : 'no args';
                    return `[Tool Call: ${tc.toolName || 'unknown'} with args: ${argsStr}]`;
                }
                // Tool results carry the LARGE payloads (file reads, command
                // output). Extracting their text is what makes the size +
                // token estimates — and therefore compression — accurate.
                if (part.type === 'tool-result') {
                    return toolResultText(part);
                }
                return `[${part.type}]`;
            })
            .join('\n');
    }
    return String(msg.content || '');
}

/** Whether a message is a tool result that reads as an error. */
export function isErrorMessage(msg: ModelMessage): boolean {
    if (msg.role !== 'tool') return false;
    const content = extractMessageContent(msg).toLowerCase();
    return content.includes('error') ||
           content.includes('failed') ||
           content.includes('exception');
}

/** Extract the tool name + args from a message's first tool-call part, if any. */
export function extractToolInfo(msg: ModelMessage): { toolName?: string; args?: ToolCallArgs } {
    const content = msg.content;
    if (Array.isArray(content)) {
        for (const part of content) {
            if (part.type === 'tool-call') {
                const tc = part as unknown as { toolName: string; args: ToolCallArgs };
                return { toolName: tc.toolName, args: tc.args };
            }
        }
    }
    return {};
}

/**
 * Compress a single message with restorable references, shrinking payloads IN
 * PLACE while preserving structure — a tool-result keeps its `toolCallId`/
 * `toolName` (so the assistant tool-call ↔ tool-result pairing the provider
 * requires stays intact), and an assistant message keeps its tool-call parts.
 * Replacing the whole `content` with a bare string (the old behaviour) produced
 * invalid messages and orphaned tool calls.
 */
export function compressMessage(msg: ModelMessage, threshold: number): ModelMessage {
    // Tool results carry the big file reads / command output. Truncate the
    // OUTPUT of each oversized part, keeping the part (and its toolCallId).
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
        const parts = (msg.content as any[]).map(part => {
            if (part?.type !== 'tool-result') return part;
            const text = toolResultText(part);
            if (text.length < threshold) return part;
            const ref = `[${part.toolName ?? 'tool'} output truncated — ${text.length} chars. Re-run the tool if you need the full result.]\n${summarizeLargeContent(text)}`;
            return { ...part, output: { type: 'text', value: ref } };
        });
        return { ...msg, content: parts } as ModelMessage;
    }

    // Assistant messages: shrink large TEXT only. NEVER drop tool-call
    // parts — that would orphan their tool-results.
    if (msg.role === 'assistant') {
        if (typeof msg.content === 'string') {
            return msg.content.length < threshold
                ? msg
                : { ...msg, content: `[response truncated — ${msg.content.length} chars]\n${summarizeLargeContent(msg.content)}` } as ModelMessage;
        }
        if (Array.isArray(msg.content)) {
            const parts = (msg.content as any[]).map(part => {
                if (part?.type !== 'text' || (part.text ?? '').length < threshold) return part;
                return { ...part, text: `[text truncated — ${part.text.length} chars]\n${summarizeLargeContent(part.text)}` };
            });
            return { ...msg, content: parts } as ModelMessage;
        }
    }

    // Default: keep original (never corrupt unknown shapes).
    return msg;
}

/**
 * Repair orphaned tool calls/results so the message list is always a valid
 * provider payload. Providers (Anthropic, OpenAI) reject a conversation where an
 * assistant `tool-call` has no matching `tool-result`, or a `tool-result` has no
 * preceding `tool-call` — and emergency truncation (slicing a recent window) or
 * an interrupted run can leave exactly those orphans.
 *
 * Two fixes, in one pass:
 *   1. An assistant `tool-call` whose id has no result anywhere → synthesize a
 *      placeholder `tool-result` immediately after that assistant message (keeps
 *      the call ↔ result pairing the provider requires).
 *   2. A `tool-result` whose id has no preceding `tool-call` → drop that part
 *      (and the whole tool message if it becomes empty). This generalizes the
 *      old "shift a leading dangling tool message" guard.
 *
 * A well-formed list passes through unchanged.
 */
export function repairToolPairs(messages: ModelMessage[]): ModelMessage[] {
    const callIds = new Set<string>();
    const resultIds = new Set<string>();
    for (const msg of messages) {
        if (!Array.isArray(msg.content)) continue;
        for (const part of msg.content as Array<{ type?: string; toolCallId?: string }>) {
            if (part?.type === 'tool-call' && part.toolCallId) callIds.add(part.toolCallId);
            if (part?.type === 'tool-result' && part.toolCallId) resultIds.add(part.toolCallId);
        }
    }

    const out: ModelMessage[] = [];
    for (const msg of messages) {
        // (2) Drop tool-result parts with no matching call.
        if (msg.role === 'tool' && Array.isArray(msg.content)) {
            const parts = msg.content as Array<{ type?: string; toolCallId?: string }>;
            const kept = parts.filter(p => p?.type !== 'tool-result' || (p.toolCallId != null && callIds.has(p.toolCallId)));
            if (kept.length === 0) continue; // whole message was orphaned results
            out.push(kept.length === parts.length ? msg : ({ ...msg, content: kept } as ModelMessage));
            continue;
        }

        out.push(msg);

        // (1) Synthesize placeholder results for an assistant's orphaned calls.
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            const orphaned = (msg.content as Array<{ type?: string; toolCallId?: string; toolName?: string }>)
                .filter(p => p?.type === 'tool-call' && p.toolCallId != null && !resultIds.has(p.toolCallId));
            if (orphaned.length > 0) {
                out.push({
                    role: 'tool',
                    content: orphaned.map(call => ({
                        type: 'tool-result',
                        toolCallId: call.toolCallId,
                        toolName: call.toolName,
                        output: { type: 'error-text', value: '[result unavailable: trimmed from context]' },
                    })),
                } as ModelMessage);
            }
        }
    }

    return out;
}

/** A brief first-lines/last-lines summary of large content, for the reference. */
export function summarizeLargeContent(content: string): string {
    const lines = content.split('\n');
    const summary: string[] = [];

    summary.push('First lines:');
    summary.push(...lines.slice(0, 3).map(l => `  ${l.slice(0, 100)}`));

    if (lines.length > 10) {
        summary.push('...');
        summary.push('Last lines:');
        summary.push(...lines.slice(-3).map(l => `  ${l.slice(0, 100)}`));
    }

    return summary.join('\n');
}

/**
 * Format messages into a readable transcript for summarization, capping each
 * message's content so the summary prompt stays bounded.
 */
export function formatMessagesForSummary(messages: ModelMessage[]): string {
    const MAX_CONTENT_LENGTH = 2000;

    const formatContent = (content: unknown): string => {
        if (typeof content === 'string') {
            return content.length > MAX_CONTENT_LENGTH
                ? content.slice(0, MAX_CONTENT_LENGTH) + '...[truncated]'
                : content;
        }
        if (Array.isArray(content)) {
            return content
                .map(part => {
                    if (part.type === 'text') {
                        return formatContent(part.text);
                    }
                    if (part.type === 'tool-call') {
                        const argsStr = part.args ? JSON.stringify(part.args).slice(0, 200) : 'no args';
                        return `[Tool Call: ${part.toolName} with args: ${argsStr}]`;
                    }
                    return `[${part.type}]`;
                })
                .join('\n');
        }
        return String(content).slice(0, MAX_CONTENT_LENGTH);
    };

    return messages
        .map((msg, index) => {
            const roleLabel = {
                system: 'System',
                user: 'User',
                assistant: 'Assistant',
                tool: 'Tool Result',
            }[msg.role] || msg.role;

            const content = formatContent(msg.content);
            return `[${index + 1}] ${roleLabel}:\n${content}`;
        })
        .join('\n\n---\n\n');
}
