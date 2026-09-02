#!/usr/bin/env bun
/**
 * Out-of-process sub-agent worker.
 *
 * Spawned by SubAgentPlugin as `bun <this file>` with an IPC channel. It waits
 * for a {@link SubAgentRunSpec}, rebuilds the live objects the spec only
 * describes (model, plugins, completion tool), runs one delegation, streams
 * deltas home, and returns an {@link ExecutionResult}.
 *
 * It deliberately does NOT shape the delegation result — no artifact writing, no
 * cache registry, no success/error classification. All of that stays in the
 * parent so both execution backends produce identical results and there is only
 * one place that decides what a delegation "means".
 *
 * Run standalone it does nothing: with no IPC channel there is no parent to
 * serve, so it exits rather than hanging.
 */

import { tool } from 'ai';
import { VibesAgent } from '../core/agent/agent';
import { createSubAgentPlugins } from '../core/agent/vibe-agent';
import {
    COMPLETION_TOOL_NAME,
    SUBAGENT_BUDGETS,
    SUBAGENT_LOOP_DETECTION,
    buildDelegationMessage,
    completionSchema,
    type ExecutionResult,
} from './sub-agent';
import type { ChildMessage, ParentMessage, SubAgentRunSpec } from './subagent-protocol';

/** Bun gives the child `process.send` only when the parent opened an IPC channel. */
const send = (message: ChildMessage): void => {
    process.send?.(message);
};

/**
 * Rebuild the model by dynamic-importing the consumer's own factory. The harness
 * ships no providers, so this indirection is what makes an out-of-process child
 * possible at all.
 */
async function resolveModel(spec: SubAgentRunSpec) {
    const exportName = spec.resolverExport ?? 'getModel';
    const mod = await import(spec.resolverModule);
    const factory = mod[exportName];
    if (typeof factory !== 'function') {
        throw new Error(
            `Model resolver "${exportName}" not found in ${spec.resolverModule} ` +
            `(exports: ${Object.keys(mod).join(', ') || 'none'})`,
        );
    }
    return factory(spec.modelSpec);
}

async function runSpec(spec: SubAgentRunSpec, abortSignal: AbortSignal): Promise<ExecutionResult> {
    const model = await resolveModel(spec);

    // Local completion tracker — the payload goes home in the `done` message.
    let payload: ExecutionResult['completionPayload'] = null;
    const completionTool = tool({
        description: 'Optional: hand back a structured summary of the completed task plus the files you created or modified.',
        inputSchema: completionSchema,
        execute: async (input) => {
            payload ??= { summary: input.summary, files: input.files ?? [], metadata: input.metadata };
            return { status: 'recorded', completionConfirmed: true };
        },
    });

    // At the depth cap a child may not spawn children of its own — it does the
    // work itself. Mirrors the parent's sub-delegation gate.
    const atDepthLimit = spec.depth >= spec.maxDepth;
    const blockedTools = [
        ...(spec.blockedTools ?? []),
        ...(atDepthLimit ? ['task', 'delegate', 'parallel_delegate', 'spawn_agent'] : []),
    ];

    const agent = new VibesAgent({
        model,
        instructions: spec.systemPrompt,
        maxSteps: spec.maxSteps,
        loopDetection: SUBAGENT_LOOP_DETECTION,
        budgets: SUBAGENT_BUDGETS,
        plugins: createSubAgentPlugins({
            model,
            workspaceDir: spec.workspaceDir,
            stateDir: spec.stateDir,
            sessionId: spec.sessionId,
        }),
        tools: { [COMPLETION_TOOL_NAME]: completionTool },
        allowedTools: spec.allowedTools
            ? Array.from(new Set([...spec.allowedTools, COMPLETION_TOOL_NAME]))
            : undefined,
        blockedTools: blockedTools.length ? blockedTools : undefined,
        contextWindow: spec.contextWindow,
        contextCompressionRatio: spec.compressionRatio,
        // The parent owns the UI stream; this child reports through IPC instead.
        emitContextGauge: false,
    });

    const result: any = await agent.stream({
        messages: [{ role: 'user', content: buildDelegationMessage(spec) }],
        abortSignal,
    });

    // Forward deltas as they arrive; the parent re-emits them through the
    // delegation-scoped writer so the UI is identical to the in-process path.
    let liveText = '';
    if (result?.fullStream?.[Symbol.asyncIterator]) {
        try {
            for await (const part of result.fullStream) {
                if (part?.type === 'text-delta' && typeof part.text === 'string') liveText += part.text;
                if (part?.type === 'text-delta' || part?.type === 'reasoning-delta') {
                    send({ type: 'stream-part', part: { type: part.type, text: part.text } });
                }
            }
        } catch {
            // Best-effort: the resolved values below are authoritative.
        }
    }

    const [rawText, steps] = await Promise.all([
        liveText ? Promise.resolve(liveText) : Promise.resolve(result.text),
        result.steps,
        result.response,
    ]).then(([text, resolvedSteps]) => [text, resolvedSteps] as const);

    const stopReason = await Promise.resolve(result.stopReason).catch(() => undefined);
    const errorText = await Promise.resolve(result.errorText).catch(() => undefined);

    return {
        rawText,
        // Only `toolCalls[].toolName` is read downstream; strip the rest so the
        // result stays structured-cloneable (steps carry non-serializable usage
        // objects in some providers).
        steps: (steps ?? []).map((s: any) => ({
            toolCalls: (s?.toolCalls ?? []).map((c: any) => ({ toolName: c?.toolName })),
        })),
        completionPayload: payload,
        ...(errorText || stopReason === 'error' || stopReason === 'aborted'
            ? { errorText: errorText || `sub-agent run ${stopReason}` }
            : {}),
    };
}

// ── entry ────────────────────────────────────────────────────────────────────

if (!process.send) {
    console.error('[subagent-worker] no IPC channel — this is spawned by SubAgentPlugin, not run directly.');
    process.exit(1);
}

const controller = new AbortController();
let running = false;

process.on('message', (message: ParentMessage) => {
    if (message?.type === 'abort') {
        controller.abort();
        return;
    }
    if (message?.type !== 'run' || running) return;
    running = true;

    runSpec(message.spec, controller.signal)
        .then((result) => send({ type: 'done', result }))
        .catch((err) => send({ type: 'error', message: err instanceof Error ? err.message : String(err) }))
        // Let the IPC write flush before the process goes away.
        .finally(() => setTimeout(() => process.exit(0), 10));
});
