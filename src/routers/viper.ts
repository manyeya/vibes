import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { logger } from "../logger";
import { viper } from "../viper";
import {
    type AgentUIMessage
} from "../deep-agent";
import {
    convertToModelMessages,
    createUIMessageStream,
    createUIMessageStreamResponse
} from "ai";

const viperSchema = z.object({
    messages: z.array(z.any()),
});

const app = new Hono();

app.post('/viper', zValidator('json', viperSchema), async (c) => {
    try {
        const body = c.req.valid('json');

        logger.info({ messages: body.messages }, 'Viper agent request received');

        const startTime = Date.now();
        // Re-typing messages to ModelMessage[] as required by DeepAgent
        const result = await viper.invoke({
            messages: await convertToModelMessages(body.messages),
        });
        const duration = Date.now() - startTime;

        const lastMessage = result.state.messages[result.state.messages.length - 1];

        logger.info({ duration }, 'Viper agent response completed');

        return c.json({
            success: true,
            response: (lastMessage?.content as any)?.[0]?.text || lastMessage?.content || null,
            state: viper.getState(),
            duration,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Viper agent error');

        return c.json({
            success: false,
            error: 'Failed to process viper agent request',
            details: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});

app.post('/viper/stream', zValidator('json', viperSchema), async (c) => {
    try {
        const body = c.req.valid('json');
        logger.info('Viper agent streaming request received');

        const stream = createUIMessageStream<AgentUIMessage>({
            execute: async ({ writer }) => {
                // Send initial status
                writer.write({
                    type: 'data-notification',
                    data: { message: 'Viper is hunting...', level: 'info' },
                    transient: true,
                });

                const result = await viper.stream({
                    state: { messages: await convertToModelMessages(body.messages) },
                    writer,
                });

                writer.merge(result.toUIMessageStream());

                // Send completion notification
                writer.write({
                    type: 'data-notification',
                    data: { message: 'Inquiry complete.', level: 'info' },
                    transient: true,
                });
            },
        });

        return createUIMessageStreamResponse({ stream });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Viper agent streaming error');

        return c.json({
            success: false,
            error: 'Failed to stream viper agent request',
        }, 500);
    }
});

export default app;
