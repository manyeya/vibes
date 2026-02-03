import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { logger } from "../logger";
import sessionManager from "../session-manager";
import { SqliteBackend, type VibesUIMessage, createDeepAgentStreamResponse } from "harness-vibes";
import { agent as simpleAgent } from "../simple";


// Shared backend instance for session management (without a specific session)
const sessionBackend = new SqliteBackend('workspace/vibes.db', 'default');

const mimoSchema = z.object({
    messages: z.array(z.any()),
    session_id: z.string().optional(),
});

const app = new Hono();


// ============ SESSION MANAGEMENT ENDPOINTS ============

/**
 * List all sessions
 */
app.get('/sessions', async (c) => {
    try {
        const sessions = await sessionBackend.listSessions();
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
        const session = await sessionBackend.getSession(sessionId);

        if (!session) {
            return c.json({
                success: false,
                error: 'Session not found',
            }, 404);
        }

        // Get files for this session
        const tempBackend = new SqliteBackend('workspace/vibes.db', sessionId);
   

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

        const sessionId = await sessionBackend.createSession(title, metadata);

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

        // Unload from memory if loaded
        sessionManager.unloadSession(sessionId);

        // Delete from database
        await sessionBackend.deleteSession(sessionId);

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
 * Update session metadata
 */
app.patch('/sessions/:id', async (c) => {
    try {
        const sessionId = c.req.param('id');
        const body = await c.req.json().catch(() => ({}));

        await sessionBackend.updateSession(sessionId, {
            title: body.title,
            summary: body.summary,
            metadata: body.metadata,
        });

        const updated = await sessionBackend.getSession(sessionId);

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
        const tempBackend = new SqliteBackend('workspace/vibes.db', sessionId);
       

        return c.json({
            success: true,
            files: tempBackend.getState().messages,
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
 */
app.get('/sessions/:id/messages', async (c) => {
    try {
        const sessionId = c.req.param('id');
        const tempBackend = new SqliteBackend('workspace/vibes.db', sessionId);
        const state = tempBackend.getState();

        // Convert AgentState messages to UI message format
        const messages = state.messages.map((msg: any, index: number) => ({
            id: `msg_${sessionId}_${index}`,
            role: msg.role,
            parts: typeof msg.content === 'string'
                ? [{ type: 'text', text: msg.content }]
                : Array.isArray(msg.content)
                    ? msg.content
                    : [{ type: 'text', text: String(msg.content) }],
        }));

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

app.post('/mimo-code', zValidator('json', mimoSchema), async (c) => {
    try {
        const body = c.req.valid('json');
        const sessionId = body.session_id || 'default';

        logger.info({ messages: body.messages, sessionId }, 'Mimo-Code agent request received');

        const agent = sessionManager.getOrCreateAgent(sessionId);

        const startTime = Date.now();
        const result = await agent.generate({
            messages: body.messages,
        });
        const duration = Date.now() - startTime;

        const lastMessage = result.state.messages[result.state.messages.length - 1];

        logger.info({ duration, sessionId }, 'Mimo-Code agent response completed');

        return c.json({
            success: true,
            response: (lastMessage?.content as any)?.[0]?.text || lastMessage?.content || null,
            duration,
            timestamp: new Date().toISOString(),
            sessionId,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Mimo-Code agent error');

        return c.json({
            success: false,
            error: 'Failed to process mimo-code agent request',
            details: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});

app.post('/mimo-code/stream', zValidator('json', mimoSchema), async (c) => {
    try {
        const body = c.req.valid('json');
        const sessionId = body.session_id || 'default';
        const messages = body.messages as any[];

        // createAgentUIStreamResponse({
        //     agent: techAgent,
        //     uiMessages: messages,
        // });



        logger.info({ sessionId }, 'Mimo-Code agent streaming request received');

        const agent = sessionManager.getOrCreateAgent(sessionId);

        // Pass originalMessages to enable proper message continuation when resubmitting after approval
        // This ensures the stream uses the correct message ID for the last assistant message
        const lastMessage = messages[messages.length - 1];
        const originalMessages = lastMessage?.role === 'assistant' ? messages : undefined;

        return createDeepAgentStreamResponse({
            agent,
            uiMessages: body.messages,
            originalMessages,
        });


    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Mimo-Code agent streaming error');

        return c.json({
            success: false,
            error: 'Failed to stream mimo-code agent request',
        }, 500);
    }
});


app.post('/simple/stream', zValidator('json', mimoSchema), async (c) => {
    try {
        const body = c.req.valid('json');
        const messages = body.messages as any[];

        // Use custom stream response that integrates with middleware writers
        // This enables onData callbacks and custom data streaming
        return createDeepAgentStreamResponse({
            agent: simpleAgent as any, // TODO: fix type mismatch
            uiMessages: messages,
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
