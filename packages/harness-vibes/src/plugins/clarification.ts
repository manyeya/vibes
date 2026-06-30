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

    get tools(): Record<string, import("ai").Tool> {
        return {
            [ASK_USER_TOOL_NAME]: tool({
                description:
                    "Ask the user focused clarifying questions when the request is genuinely ambiguous or " +
                    "a wrong assumption would waste real work (scope, target, tech choice, design direction). " +
                    "Renders a short questionnaire above the composer; the user's answers return as their next " +
                    "message. Use sparingly — only when the answer materially changes what you build, and never " +
                    "ask what you can decide with a sensible default or look up in the code. After calling this, " +
                    "stop and wait for the answers.\n\n" +
                    "Pick the right `kind` per question:\n" +
                    "- 'single' — pick one of a few options (the default).\n" +
                    "- 'multi' — when several answers can apply (e.g. which features/pages/integrations). USE THIS " +
                    "whenever the question naturally has more than one answer; optionally set min/max selections.\n" +
                    "- 'boolean' — a yes/no decision (don't fake it with single + Yes/No options).\n" +
                    "- 'number' — a quantity/budget/count (optionally set min/max value and a unit like \"$\").\n" +
                    "- 'text' — only for inherently open answers (a name, a freeform description).\n\n" +
                    "For single/multi give 2–4 concrete `options`; the UI auto-appends a free-text \"Other\" write-in, " +
                    "so do NOT add your own \"Other\"/\"Custom\"/\"(specify)\"/\"None of the above\" choice. " +
                    "Set `allowCustom:false` to lock a question to its options, and `required:false` for optional ones.",
                inputSchema: z.object({
                    title: z.string().optional().describe('Optional short heading for the questionnaire.'),
                    questions: z
                        .array(
                            z.object({
                                question: z.string().describe('The question to ask. Be specific.'),
                                description: z.string().optional().describe('Optional one-line context/help shown under the question.'),
                                kind: z
                                    .enum(['single', 'multi', 'text', 'boolean', 'number'])
                                    .default('single')
                                    .describe("single (default) · multi (several answers) · boolean (yes/no) · number · text (free-form)."),
                                options: z
                                    .array(z.string())
                                    .min(2)
                                    .optional()
                                    .describe("2–4 concrete choices for single/multi (no 'Other'/'Custom' — it's auto-added)."),
                                allowCustom: z.boolean().optional().describe('Allow a free-text write-in for single/multi (default true). Set false to lock to options.'),
                                min: z.number().optional().describe('multi: min selections · number: min value.'),
                                max: z.number().optional().describe('multi: max selections · number: max value.'),
                                unit: z.string().optional().describe('number: unit suffix, e.g. "$" or "items".'),
                                placeholder: z.string().optional().describe('text/number: input placeholder.'),
                                required: z.boolean().optional().describe('Whether it must be answered (default true).'),
                            }),
                        )
                        .min(1)
                        .max(6)
                        .describe('1–6 questions. Keep it tight; mix the kinds as appropriate.'),
                }),
                execute: async ({ title, questions }) => {
                    const operation = this.streamContext?.createOperation({
                        name: 'ask-user',
                        toolName: ASK_USER_TOOL_NAME,
                        plugin: this.name,
                    });
                    const id = `ask_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
                    const normalized = questions.map((q, i) => ({
                        id: `q${i + 1}`,
                        question: q.question,
                        description: q.description,
                        kind: q.kind ?? 'single',
                        options: q.options,
                        allowCustom: q.allowCustom,
                        min: q.min,
                        max: q.max,
                        unit: q.unit,
                        placeholder: q.placeholder,
                        required: q.required,
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
For a genuinely ambiguous or high-stakes request — where guessing wrong would waste real work — call \`${ASK_USER_TOOL_NAME}\` with 1–6 focused questions instead of assuming. It shows the user a short questionnaire and your run pauses until they answer. Prefer sensible defaults and reading the codebase first; only ask when the answer truly changes what you build, and never ask more than you need.

Match the question to its \`kind\`: \`multi\` when several answers can apply (features, pages, integrations), \`boolean\` for yes/no, \`number\` for a quantity/budget, \`single\` for one-of-a-few, \`text\` only for open answers. Give single/multi 2–4 concrete options; a free-text "Other" is auto-added, so don't add your own "Other"/"Custom"/"(specify)" choice.`;
    }
}
