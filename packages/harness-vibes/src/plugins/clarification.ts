import { tool, type UIMessageStreamWriter } from "ai";
import z from "zod";
import {
    Plugin,
    PluginStreamContext,
    VibesUIMessage,
    createDataStreamWriter,
    type DataStreamWriter,
} from "../core/types";

export const ASK_USER_TOOL_NAME = 'ask_user';

/**
 * Lets the agent pause and ask the user structured clarifying questions for
 * genuinely ambiguous or high-stakes requests. `ask_user` streams a
 * `data-clarification` part (a questionnaire) that the web UI renders as a form
 * above the composer; the user's answers come back as the next message.
 *
 * The agent's run is expected to STOP after calling this (wire
 * `stopWhen: hasToolCall('ask_user')` on the agent), so control returns to the
 * user instead of the model guessing and forging ahead.
 */
export default class ClarificationPlugin implements Plugin {
    name = 'ClarificationPlugin';
    private writer?: DataStreamWriter;
    private streamContext?: PluginStreamContext;

    onStreamContextReady(context: PluginStreamContext) {
        this.streamContext = context;
        this.writer = context.writer.withDefaults({ plugin: this.name });
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.streamContext = undefined;
        this.writer = createDataStreamWriter(writer).withDefaults({ plugin: this.name });
    }

    get tools() {
        return {
            [ASK_USER_TOOL_NAME]: tool({
                description:
                    "Ask the user focused clarifying questions when the request is genuinely ambiguous or " +
                    "a wrong assumption would waste real work (scope, target, tech choice, design direction). " +
                    "Renders a short questionnaire above the composer; the user's answers return as their next " +
                    "message. Use sparingly — only when the answer materially changes what you build. Do NOT " +
                    "ask about things you can decide with a sensible default, look up in the code, or figure out " +
                    "yourself. After calling this, stop and wait for the answers.\n\n" +
                    "Make every question MULTIPLE CHOICE: give 2–4 concrete `options` (kind 'single' or 'multi'). " +
                    "The UI automatically appends a free-text \"Other\" as the LAST option, so the user can always " +
                    "write their own answer — you almost never need kind 'text' (reserve it for inherently open " +
                    "answers like a name or a freeform description).",
                inputSchema: z.object({
                    title: z.string().optional().describe('Optional short heading for the questionnaire.'),
                    questions: z
                        .array(
                            z.object({
                                question: z.string().describe('The question to ask. Be specific.'),
                                kind: z
                                    .enum(['single', 'multi', 'text'])
                                    .default('single')
                                    .describe("single = pick one option (default), multi = pick several, text = free-form only. Prefer single/multi."),
                                options: z
                                    .array(z.string())
                                    .min(2)
                                    .optional()
                                    .describe("2–4 concrete choices for single/multi questions. The UI auto-adds a free-text 'Other' as the last option, so the user can always write their own — provide options for almost every question."),
                            }),
                        )
                        .min(1)
                        .max(6)
                        .describe('1–6 questions. Keep it tight.'),
                }),
                execute: async ({ title, questions }) => {
                    const operation = this.streamContext?.createOperation({
                        name: 'ask-user',
                        toolName: ASK_USER_TOOL_NAME,
                        plugin: this.name,
                        heartbeatEnabled: false,
                    });
                    const id = `ask_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
                    const normalized = questions.map((q, i) => ({
                        id: `q${i + 1}`,
                        question: q.question,
                        kind: q.kind ?? 'single',
                        options: q.options,
                    }));

                    this.writer?.writeClarification({ id, title, questions: normalized });
                    operation?.complete(`Asked the user ${normalized.length} question${normalized.length === 1 ? '' : 's'}`, { phase: 'complete' });

                    return {
                        status: 'awaiting_user_answers',
                        questionCount: normalized.length,
                        message:
                            'The questionnaire is now shown to the user above the composer. Stop here and wait — ' +
                            'their answers will arrive as the next message. Do not take any further action until then.',
                    };
                },
            }),
        };
    }

    modifySystemPrompt(prompt: string): string {
        return `${prompt}

## Asking the user
For a genuinely ambiguous or high-stakes request — where guessing wrong would waste real work — call \`${ASK_USER_TOOL_NAME}\` with 1–6 focused questions instead of assuming. It shows the user a short questionnaire and your run pauses until they answer. Prefer sensible defaults and reading the codebase first; only ask when the answer truly changes what you build, and never ask more than you need. Make each question multiple-choice with 2–4 concrete options — the UI adds a free-text "Other" as the last option automatically, so the user can always write their own.`;
    }
}
