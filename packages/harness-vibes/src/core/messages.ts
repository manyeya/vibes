/**
 * Message conversion at the LLM boundary.
 *
 * The transcript is `ModelMessage[]` throughout (we did not adopt pi's
 * app-level message union). The only conversion needed is UIMessage[] →
 * ModelMessage[] on the way in, which the AI SDK's `convertToModelMessages`
 * handles. Ported from `AgentHarness.convertMessages`.
 */

import { convertToModelMessages, type ModelMessage, type ToolSet, type UIMessage } from 'ai';

/** A message that may carry UI `parts` (a UIMessage) rather than model `content`. */
interface PartedMessage {
    role: string;
    content?: unknown;
    parts?: Array<{ type: string; data?: unknown }>;
}

/**
 * Convert incoming messages to `ModelMessage[]`. UIMessage[] (detected by the
 * first message carrying `parts`) is run through the SDK converter with the
 * agent's tool set so tool parts resolve; ModelMessage[] passes through. Tools
 * are needed only for the UIMessage path, so they're supplied lazily.
 */
export async function toModelMessages(
    messages: UIMessage[] | ModelMessage[],
    getTools: () => ToolSet | Promise<ToolSet>,
): Promise<ModelMessage[]> {
    if (messages.length === 0) return [];

    const first = messages[0] as PartedMessage;
    if (first.parts !== undefined) {
        const tools = await getTools();
        return convertToModelMessages(messages as UIMessage[], {
            tools,
            // Drop incomplete tool calls left by an interrupted/aborted stream.
            ignoreIncompleteToolCalls: true,
        });
    }

    return messages as ModelMessage[];
}

/** The latest user message's text, for adaptive-reasoning classification. */
export function lastUserText(messages: ModelMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
            const content = messages[i].content;
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) {
                return content
                    .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
                    .join('');
            }
        }
    }
    return '';
}
