import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { logger } from "../logger";
import { mimoCode } from "../mimo-code";
import { type AgentUIMessage } from "../the-vibes";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

const mimoSchema = z.object({
    messages: z.array(z.any()),
});

const app = new Hono();

app.post('/mimo-code', zValidator('json', mimoSchema), async (c) => {
    try {
        const body = c.req.valid('json');

        logger.info({ messages: body.messages }, 'Mimo-Code agent request received');

        const startTime = Date.now();
        const result = await mimoCode.generate({
            messages: body.messages,
        });
        const duration = Date.now() - startTime;

        const lastMessage = result.state.messages[result.state.messages.length - 1];

        logger.info({ duration }, 'Mimo-Code agent response completed');

        return c.json({
            success: true,
            response: (lastMessage?.content as any)?.[0]?.text || lastMessage?.content || null,
            state: mimoCode.getState(),
            duration,
            timestamp: new Date().toISOString(),
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
        const messages = body.messages as any[];
        logger.info('Mimo-Code agent streaming request received');

        // Pass originalMessages to enable proper message continuation when resubmitting after approval
        // This ensures the stream uses the correct message ID for the last assistant message
        const lastMessage = messages[messages.length - 1];
        const originalMessages = lastMessage?.role === 'assistant' ? messages : undefined;

        const stream = createUIMessageStream<AgentUIMessage>({
            execute: ({ writer }) => {
                writer.write({
                    type: 'data-notification',
                    data: { message: 'Mimo-Code is analyzing...', level: 'info' },
                });

                // Start the stream and immediately merge - don't await stream() first
                // The createUIMessageStream will wait for all merged streams to complete
                const streamPromise = mimoCode.stream({
                    messages: body.messages,
                    writer,
                }).then(result => {
                    // Merge the result stream immediately - AI SDK includes usage automatically
                    writer.merge(result.toUIMessageStream());

                    // Write completion notification after the stream is done
                    return result.response.then(() => {
                        writer.write({
                            type: 'data-notification',
                            data: { message: 'Mimo-Code task complete.', level: 'info' },
                        });
                    });
                });

                // Return the promise so createUIMessageStream waits for it
                return streamPromise;
            },
            originalMessages, // Pass for proper message ID handling during continuation
        });

        return createUIMessageStreamResponse({ stream });
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

export default app;
