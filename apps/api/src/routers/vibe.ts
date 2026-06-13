import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { logger } from "../logger";
import streamCoordinator from "../stream-coordinator";
import { vibeHarness, defaultSubAgents } from "../vibe-coder";
import { SqliteBackend, createAgentStreamResponse } from "../../../../packages/harness-vibes/index";
import { agent as simpleAgent } from "../simple-agent";
import { getModel, getAvailableModels, getContextWindow, getDefaultModelId, isKnownModelId } from "../model-factory";

/**
 * Loose message shape accepted by the streaming endpoints. AI SDK in
 * practice emits more roles than the spec lists (tool, function,
 * developer, system, …) and some message shapes appear with `parts` but
 * without `content`, or vice versa. We validate the minimum invariant —
 * `role` is a string and the message carries either `parts` or `content`
 * — and pass the rest through to the agent's `convertMessages`, which
 * already handles the union of UIMessage and ModelMessage.
 */
const messagePartSchema = z.object({
    type: z.string(),
}).passthrough();

const apiMessageSchema = z.object({
    id: z.string().optional(),
    role: z.string(),
    parts: z.array(messagePartSchema).optional(),
    content: z.union([z.string(), z.array(z.unknown())]).optional(),
}).passthrough().refine(
    (msg) => msg.parts !== undefined || msg.content !== undefined,
    { message: 'message must carry parts (UIMessage) or content (ModelMessage)' }
);

const vibeSchema = z.object({
    messages: z.array(apiMessageSchema),
    session_id: z.string().nullable().optional(),
    /** Optional per-request OpenRouter model id from the UI model selector. */
    model: z.string().nullable().optional(),
    /** Optional web-search backend preference from the UI settings ('auto' | 'exa' | 'tavily' | 'brave'). */
    search_provider: z.string().nullable().optional(),
}).passthrough();

type ApiMessage = z.infer<typeof apiMessageSchema>;

const app = new Hono();

/** Models available to the UI model selector + the current default. Pulls the
 *  live free OpenRouter catalog (grouped), with a curated fallback. */
app.get('/models', async (c) => {
    const models = await getAvailableModels();
    const preferred = getDefaultModelId();
    const active = models.some((m) => m.id === preferred) ? preferred : models[0]?.id;
    return c.json({ success: true, models, active });
});

/**
 * Apply a per-request model override to a session's agent. A valid id from
 * the selector swaps the model for this run; anything else reverts to the
 * agent's constructed default.
 */
function applyModelOverride(
    agent: {
        setModelOverride: (m?: ReturnType<typeof getModel>) => void;
        setContextWindow: (w: number, r?: number) => void;
    },
    modelId: unknown,
): void {
    const id = typeof modelId === 'string' && modelId.trim() ? modelId.trim() : undefined;
    const known = id ? isKnownModelId(id) : false;
    agent.setModelOverride(known ? getModel({ provider: 'openrouter', id: id! }) : undefined);
    // Keep the context gauge + compression threshold aligned with the active
    // model's real window — selector models range from a few k to 1M tokens, so
    // a window frozen to the startup default would make the gauge meaningless.
    agent.setContextWindow(getContextWindow(known ? id! : getDefaultModelId()));
}

/**
 * Apply the UI's web-search backend preference for this run. The plugin
 * validates the id and falls back to env auto-detection for 'auto' or any
 * unconfigured backend, so we pass it through verbatim.
 */
function applySearchProvider(agent: { setSearchProviderPreference: (p?: string) => void }, provider: unknown): void {
    agent.setSearchProviderPreference(typeof provider === 'string' && provider.trim() ? provider.trim() : undefined);
}


/** The roster of built-in sub-agents the UI can target a message at. */
app.get('/agents', (c) => {
    return c.json({
        success: true,
        agents: defaultSubAgents.map((a) => ({ name: a.name, description: a.description })),
    });
});

// ============ SESSION MANAGEMENT ENDPOINTS ============

/**
 * List all sessions
 */
app.get('/sessions', async (c) => {
    try {
        const sessions = await vibeHarness.listSessions();
        return c.json({
            success: true,
            sessions,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to list sessions');

        return c.json({
            success: false,
            error: 'Failed to list sessions',
        }, 500);
    }
});

/**
 * Get a specific session
 */
app.get('/sessions/:id', async (c) => {
    try {
        const sessionId = c.req.param('id');
        const session = await vibeHarness.getSessionInfo(sessionId);

        if (!session) {
            return c.json({
                success: false,
                error: 'Session not found',
            }, 404);
        }

        return c.json({
            success: true,
            session: {
                ...session
            },
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to get session');

        return c.json({
            success: false,
            error: 'Failed to get session',
        }, 500);
    }
});

/**
 * Create a new session
 */
app.post('/sessions', async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const title = body.title;
        const metadata = body.metadata || {};

        const sessionId = await vibeHarness.createSession({ title, metadata });

        return c.json({
            success: true,
            sessionId,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to create session');

        return c.json({
            success: false,
            error: 'Failed to create session',
        }, 500);
    }
});

/**
 * Delete a session
 */
app.delete('/sessions/:id', async (c) => {
    try {
        const sessionId = c.req.param('id');
        await vibeHarness.deleteSession(sessionId);

        return c.json({
            success: true,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to delete session');

        return c.json({
            success: false,
            error: 'Failed to delete session',
        }, 500);
    }
});

/**
 * Abort the session's currently-active stream, if any.
 */
app.post('/sessions/:id/abort', async (c) => {
    try {
        const sessionId = c.req.param('id');
        const aborted = streamCoordinator.abortStream(sessionId, 'client requested abort');
        return c.json({ success: true, aborted });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to abort stream');
        return c.json({ success: false, error: 'Failed to abort stream' }, 500);
    }
});

/**
 * Update session metadata
 */
app.patch('/sessions/:id', async (c) => {
    try {
        const sessionId = c.req.param('id');
        const body = await c.req.json().catch(() => ({}));

        await vibeHarness.updateSession(sessionId, {
            title: body.title,
            summary: body.summary,
            metadata: body.metadata,
        });

        const updated = await vibeHarness.getSessionInfo(sessionId);

        return c.json({
            success: true,
            session: updated,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to update session');

        return c.json({
            success: false,
            error: 'Failed to update session',
        }, 500);
    }
});

/**
 * Get files for a session
 */
app.get('/sessions/:id/files', async (c) => {
    try {
        const sessionId = c.req.param('id');

        return c.json({
            success: true,
            files: vibeHarness.readState(sessionId).messages,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to get session files');

        return c.json({
            success: false,
            error: 'Failed to get session files',
        }, 500);
    }
});

/**
 * Get messages for a session (for loading chat history)
 *
 * IMPORTANT: this endpoint serves UIMessages back to `useChat`, which will
 * resend them on the next user turn. ModelMessage shapes that round-trip
 * badly (role:'tool', orphan tool-call parts without their matching
 * tool-result) are stripped here — leave them in and the next request
 * to any provider that doesn't natively accept role:'tool' messages
 * (e.g. some OpenRouter-routed models) returns "Unsupported role: tool".
 *
 * Tool runs are visible LIVE during a session via the streaming data
 * parts; on reload we keep only the user/assistant text exchange.
 */
app.get('/sessions/:id/messages', async (c) => {
    try {
        const sessionId = c.req.param('id');

        // Prefer the persisted full UI messages — their parts include the
        // data-* activity (ToT thoughts, tool progress, delegation, status),
        // so a reload restores the whole thread, not just text.
        const storedUi = vibeHarness.readUIMessages(sessionId);
        if (storedUi && storedUi.length > 0) {
            return c.json({ success: true, messages: storedUi });
        }

        // Fallback for sessions persisted before UI-message storage existed:
        // reconstruct the user/assistant text + reasoning from model messages.
        const state = vibeHarness.readState(sessionId);

        const messages = state.messages
            // Drop role:'tool' messages — UIMessage doesn't have a tool
            // role, and their content (tool results) can't be replayed
            // without the matching tool-call context.
            .filter((msg: any) => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system')
            .map((msg: any, index: number) => {
                let parts: Array<{ type: string; text: string }>;

                if (typeof msg.content === 'string') {
                    parts = [{ type: 'text', text: msg.content }];
                } else if (Array.isArray(msg.content)) {
                    // Keep only displayable text / reasoning parts. Tool-call
                    // parts on assistant messages would be orphaned without
                    // their matching tool-result, so the provider rejects
                    // the next turn — strip them.
                    parts = msg.content
                        .filter((p: any) => {
                            const t = p?.type;
                            return t === 'text' || t === 'reasoning' || t === 'thinking';
                        })
                        .map((p: any) => ({
                            type: p.type === 'text' ? 'text' : 'reasoning',
                            text: p.text ?? p.reasoning ?? '',
                        }))
                        .filter((p: { text: string }) => p.text.length > 0);
                } else {
                    parts = [{ type: 'text', text: String(msg.content) }];
                }

                if (parts.length === 0) return null;
                return {
                    id: `msg_${sessionId}_${index}`,
                    role: msg.role,
                    parts,
                };
            })
            .filter((m): m is { id: string; role: string; parts: Array<{ type: string; text: string }> } => m !== null);

        return c.json({
            success: true,
            messages,
            summary: state.summary,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to get session messages');

        return c.json({
            success: false,
            error: 'Failed to get session messages',
        }, 500);
    }
});

// ============ AGENT INTERACTION ENDPOINTS ============

app.post('/vibe', zValidator('json', vibeSchema), async (c) => {
    try {
        const body = c.req.valid('json');
        const sessionId = body.session_id || 'default';

        logger.info({ messages: body.messages, sessionId }, 'Vibe agent request received');

        const agent = (await vibeHarness.session(sessionId)).raw;
        applyModelOverride(agent, body.model);
        applySearchProvider(agent, body.search_provider);

        const startTime = Date.now();
        // The agent's `generate({messages})` overload accepts ModelMessage[]
        // | UIMessage[]; our zod schema validates the looser API shape and
        // the agent re-converts at the call boundary via convertMessages.
        // The single cast here is honest about that boundary handoff.
        type GenerateOpts = Parameters<typeof agent.generate>[0];
        const result = await agent.generate({
            messages: body.messages,
        } as unknown as GenerateOpts);
        const duration = Date.now() - startTime;

        const lastMessage = result.state.messages[result.state.messages.length - 1];
        // `ModelMessage.content` is either a string or an array of typed
        // parts. Narrow safely without `as any` so a malformed message
        // doesn't crash the response builder.
        const responseText: string | null = (() => {
            const c = lastMessage?.content;
            if (typeof c === 'string') return c;
            if (Array.isArray(c)) {
                const textPart = c.find(
                    (p): p is { type: 'text'; text: string } =>
                        typeof p === 'object' && p !== null && (p as { type?: unknown }).type === 'text'
                );
                return textPart?.text ?? null;
            }
            return null;
        })();

        logger.info({ duration, sessionId }, 'Vibe agent response completed');

        return c.json({
            success: true,
            response: responseText,
            duration,
            timestamp: new Date().toISOString(),
            sessionId,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Vibe agent error');

        return c.json({
            success: false,
            error: 'Failed to process vibe agent request',
            details: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});

app.post('/vibe/stream', zValidator('json', vibeSchema), async (c) => {
    try {
        const body = c.req.valid('json');
        const sessionId = body.session_id || 'default';
        const messages: ApiMessage[] = body.messages;

        logger.info({ sessionId }, 'Vibe agent streaming request received');

        // The harness owns the agent + backend for this session (built once,
        // then cached). The HTTP layer no longer caches agents or opens its
        // own SQLite connection.
        const session = await vibeHarness.session(sessionId);
        const agent = session.raw;
        const sessionBackend = session.backend!;
        applyModelOverride(agent, body.model);
        applySearchProvider(agent, body.search_provider);

        // Pass originalMessages so AI SDK reuses message IDs when the client
        // resubmits after a tool approval. We detect that case either by the
        // last message being an assistant turn OR by it carrying any
        // tool-approval-response part (which is what addToolApprovalResponse
        // appends client-side).
        const lastMessage = messages[messages.length - 1];
        const lastParts = 'parts' in (lastMessage ?? {}) ? (lastMessage as { parts: Array<{ type: string }> }).parts : undefined;
        const hasApprovalResponse = Array.isArray(lastParts)
            && lastParts.some(p => p?.type === 'tool-approval-response');
        const originalMessages = (lastMessage?.role === 'assistant' || hasApprovalResponse)
            ? messages
            : undefined;

        // Build an AbortController for this stream. Unlike pre-resumable
        // PRs, we deliberately do NOT link this to `c.req.raw.signal`: a
        // client disconnect should leave the underlying loop running so a
        // reconnect can pick up via the live tail. Only an explicit
        // POST /sessions/:id/abort triggers cancellation.
        const streamController = new AbortController();
        streamCoordinator.registerStreamController(sessionId, streamController);

        // Provision a streamId + registry entry + SQLite stream row so
        // both the live-tail and replay paths agree on the same identity.
        const streamId = crypto.randomUUID();
        streamCoordinator.streamRegistry.create(streamId, sessionId);
        sessionBackend.beginStream(streamId, sessionId);

        const onChunk = (chunk: unknown) => {
            const entry = streamCoordinator.streamRegistry.get(streamId);
            if (!entry) return;
            // Persist first, then fan out — so a reconnect that arrives
            // between persist and emit sees the chunk in SQLite and the
            // subscriber can dedupe by seq.
            entry.lastSeq += 1;
            const seq = entry.lastSeq;
            try {
                sessionBackend.appendStreamChunk(streamId, seq, chunk);
            } catch (err) {
                console.error('[vibe] appendStreamChunk failed:', err);
            }
            for (const sub of entry.subscribers) {
                try { sub(seq, chunk); } catch (err) { console.error('[vibe] subscriber threw:', err); }
            }
        };

        const onStreamEnd = (status: 'completed' | 'failed') => {
            try { sessionBackend.endStream(streamId, status); } catch (err) {
                console.error('[vibe] endStream failed:', err);
            }
            streamCoordinator.streamRegistry.complete(streamId, status);
            streamCoordinator.clearStreamController(sessionId, streamController);
        };

        const response = await createAgentStreamResponse({
            agent,
            uiMessages: body.messages as unknown as Parameters<typeof createAgentStreamResponse>[0]['uiMessages'],
            originalMessages: originalMessages as unknown as Parameters<typeof createAgentStreamResponse>[0]['originalMessages'],
            backend: sessionBackend,
            abortSignal: streamController.signal,
            onChunk,
            onStreamEnd,
        });

        // Surface the streamId so the client can pass it back to the
        // reconnect endpoint after a network blip.
        const headers = new Headers(response.headers);
        headers.set('x-vibes-stream-id', streamId);
        headers.set('access-control-expose-headers', 'x-vibes-stream-id');
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });


    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Vibe agent streaming error');

        return c.json({
            success: false,
            error: 'Failed to stream vibe agent request',
        }, 500);
    }
});


/**
 * Reconnect to an in-flight stream. The client passes the streamId it
 * received via the `x-vibes-stream-id` header on the original POST plus
 * the last chunk_seq it actually processed (`fromSeq`). The endpoint
 * replays any persisted chunks past fromSeq, then — if the stream is
 * still active in the in-memory registry — subscribes to the live tail
 * and forwards new chunks until the stream ends.
 *
 * Returns 204 if the stream is unknown or its persisted log has aged
 * past the replay TTL.
 */
const RECONNECT_REPLAY_TTL_MS = 5 * 60 * 1000;

app.get('/vibe/:sessionId/stream', async (c) => {
    const sessionId = c.req.param('sessionId');
    const streamId = c.req.query('streamId');
    const fromSeqStr = c.req.query('fromSeq') ?? '0';
    const fromSeq = Math.max(0, Number.parseInt(fromSeqStr, 10) || 0);

    if (!streamId) {
        return c.json({ success: false, error: 'streamId query param required' }, 400);
    }

    const backend = new SqliteBackend('workspace/vibes.db', sessionId);
    const meta = backend.getStreamMeta(streamId);
    if (!meta || meta.sessionId !== sessionId) {
        return c.body(null, 204);
    }

    // Apply replay TTL to completed streams: long-since-finished streams
    // shouldn't be replayable indefinitely.
    if (meta.endedAt) {
        const endedAtMs = new Date(meta.endedAt).getTime();
        if (Date.now() - endedAtMs > RECONNECT_REPLAY_TTL_MS) {
            return c.body(null, 204);
        }
    }

    const registry = streamCoordinator.streamRegistry;
    const liveEntry = registry.get(streamId);

    const stream = new ReadableStream<UIMessageChunk<unknown, never>>({
        start(controller) {
            // Phase 1: replay persisted chunks up to the current cursor.
            // We capture lastReplayedSeq so the live-tail subscriber can
            // dedupe any chunk that landed in SQLite between read + emit.
            let lastReplayedSeq = fromSeq - 1;
            try {
                const persisted = backend.readStreamChunks(streamId, fromSeq);
                for (const row of persisted) {
                    controller.enqueue(row.payload as UIMessageChunk<unknown, never>);
                    lastReplayedSeq = Math.max(lastReplayedSeq, row.chunkSeq);
                }
            } catch (err) {
                console.error('[vibe] replay failed:', err);
            }

            // Phase 2: if the stream has already ended, close after replay.
            if (!liveEntry || liveEntry.completed) {
                controller.close();
                return;
            }

            // Phase 3: subscribe to the live tail. Forward only chunks
            // whose seq is strictly greater than the highest replayed seq.
            const unsubscribe = registry.subscribe(
                streamId,
                (seq, chunk) => {
                    if (seq <= lastReplayedSeq) return;
                    try {
                        controller.enqueue(chunk as UIMessageChunk<unknown, never>);
                    } catch (err) {
                        console.error('[vibe] live forward failed:', err);
                    }
                },
                () => {
                    try { controller.close(); } catch { /* already closed */ }
                }
            );

            // Best-effort: tear down the subscriber if the client cancels
            // the response. Hono propagates this via the request signal.
            const clientSignal = c.req.raw.signal;
            const onAbort = () => {
                unsubscribe();
                try { controller.close(); } catch { /* already closed */ }
            };
            if (clientSignal.aborted) {
                onAbort();
            } else {
                clientSignal.addEventListener('abort', onAbort, { once: true });
            }
        },
    });

    return createUIMessageStreamResponse({
        stream,
        headers: {
            'X-Accel-Buffering': 'no',
            'x-vibes-stream-id': streamId,
        },
    });
});

app.post('/simple/stream', zValidator('json', vibeSchema), async (c) => {
    try {
        const body = c.req.valid('json');
        const messages: ApiMessage[] = body.messages;

        // Use custom stream response that integrates with middleware writers
        // This enables onData callbacks and custom data streaming
        const sessionBackend = new SqliteBackend('workspace/vibes.db', 'default');
        return createAgentStreamResponse({
            agent: simpleAgent,
            uiMessages: messages as unknown as Parameters<typeof createAgentStreamResponse>[0]['uiMessages'],
            backend: sessionBackend,
        });

    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Simple agent streaming error');

        return c.json({
            success: false,
            error: 'Failed to stream simple agent request',
        }, 500);
    }
});

export default app;
