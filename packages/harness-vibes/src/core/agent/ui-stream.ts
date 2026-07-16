/**
 * UI-stream adapter: raw model stream parts → `UIMessageChunk`s.
 *
 * The loop calls `streamText` once per step, so its parts arrive as N separate
 * mini-streams. To keep the web/TUI/reconnect layers seeing ONE coherent
 * assistant message, this adapter emits exactly one `start` (stable messageId)
 * and one trailing `finish`, and runs every model part through the SDK's
 * per-part `toUIMessageChunk` with `sendStart`/`sendFinish` suppressed. The
 * SDK converter handles text, reasoning, tool-input streaming, per-step
 * `start-step`/`finish-step`, AND `tool-result` → `tool-output-available`
 * (tools keep their `execute`, so results stream from `fullStream`).
 *
 * Plugin `data-*` parts do NOT flow through here — they go straight to the
 * `UIMessageStreamWriter` via the DataStreamWriter, unchanged.
 */

import { toUIMessageChunk, type ToolSet, type UIMessageChunk } from 'ai';
import type { ModelStreamPart } from './loop-events';

export interface UIChunkAdapter {
    /** The chunk stream to hand to `writer.merge(...)` / `toUIMessageStream()`. */
    readonly stream: ReadableStream<UIMessageChunk>;
    /** Forward one raw model stream part (no-op for start/finish parts). */
    handlePart(part: ModelStreamPart): void;
    /** Emit a terminal error chunk (does not close; call `finish` after). */
    error(errorText: string): void;
    /** Emit the single trailing `finish` chunk and close the stream. */
    finish(): void;
}

export interface UIChunkAdapterOptions {
    /** Stable id for the whole run's assistant message (keeps useChat merging one message). */
    messageId: string;
    /** Tool set, so the converter can tag static vs. dynamic tool parts. */
    tools: ToolSet;
    /** Sanitise error text before it reaches the client (defaults to the message). */
    onError?: (error: unknown) => string;
}

/**
 * Create a UI-chunk adapter. The stream starts with a single `start` chunk
 * carrying `messageId`; nothing else is emitted until the loop feeds parts.
 */
export function createUIChunkAdapter(opts: UIChunkAdapterOptions): UIChunkAdapter {
    let controller: ReadableStreamDefaultController<UIMessageChunk> | undefined;
    let closed = false;
    const buffer: UIMessageChunk[] = [];

    const push = (chunk: UIMessageChunk) => {
        if (closed) return;
        if (controller) controller.enqueue(chunk);
        else buffer.push(chunk);
    };

    const stream = new ReadableStream<UIMessageChunk>({
        start(c) {
            controller = c;
            for (const chunk of buffer.splice(0)) c.enqueue(chunk);
        },
    });

    // The one `start` chunk for the whole run — stable id so every subsequent
    // step's parts attach to the same assistant message.
    push({ type: 'start', messageId: opts.messageId } as UIMessageChunk);

    return {
        stream,
        handlePart(part) {
            const chunk = toUIMessageChunk<ToolSet>(part, {
                tools: opts.tools,
                sendStart: false,
                sendFinish: false,
                ...(opts.onError ? { onError: opts.onError } : {}),
            });
            if (chunk) push(chunk as UIMessageChunk);
        },
        error(errorText) {
            push({ type: 'error', errorText } as UIMessageChunk);
        },
        finish() {
            if (closed) return;
            push({ type: 'finish' } as UIMessageChunk);
            closed = true;
            controller?.close();
        },
    };
}
