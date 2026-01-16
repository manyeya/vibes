import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { logger } from "../logger";
import { createUIMessageStreamResponse, UIMessage } from "ai";
import { toBaseMessages, toUIMessageStream } from "@ai-sdk/langchain";
import vibes from "../vibes";

const agentSchema = z.object({
    messages: z.array(
        z.object({
            role: z.enum(['system', 'user', 'assistant']),
            content: z.string(),
        })
    ),
});

const app = new Hono();

app.post('/vibes', zValidator('json', agentSchema), async (c) => {
    try {
        const body = c.req.valid('json');

        logger.info({ messages: body.messages }, 'Vibes agent request received');

        const startTime = Date.now();
        const result = await vibes.invoke({
            messages: body.messages,
        }, {
            recursionLimit: 500,
        });
        const duration = Date.now() - startTime;

        const lastMessage = result.messages[result.messages.length - 1];

        logger.info({ duration }, 'Vibes agent response completed');

        return c.json({
            success: true,
            response: lastMessage?.content || null,
            todos: result.todos,
            duration,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Vibes agent error');

        return c.json({
            success: false,
            error: 'Failed to process vibes agent request',
            details: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});


app.post('/vibes/stream', async c => {
    const { messages }: { messages: UIMessage[] } = await c.req.json();
    // Filter out system messages to avoid "Cannot change both systemPrompt and systemMessage" error
    // because vibes agent already has a configured systemPrompt
    const userAndAssistantMessages = messages.filter(m => m.role !== 'system');
    const langchainMessages = await toBaseMessages(userAndAssistantMessages);
    const stream = vibes.streamEvents(
        { messages: langchainMessages },
        { recursionLimit: 500, version: "v2" },
    );
    return createUIMessageStreamResponse({
        stream: toUIMessageStream(stream),
    });
});

export default app;
