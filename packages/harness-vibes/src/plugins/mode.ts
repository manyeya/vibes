import { tool } from 'ai';
import { z } from 'zod';
import type { Plugin } from '../core/types';
import { AGENT_MODES, type AgentMode } from '../core/agent/modes';

/**
 * Gives the agent a `set_mode` tool so it can switch its own execution mode —
 * e.g. finish investigating in `plan`, then switch to `manual`/`auto-edit` to
 * carry the plan out. The tool is read-classified, so it's never gated (the
 * agent can always change mode, even from within plan mode).
 *
 * The user switches mode through the UI/API (the agent's `setMode`); this
 * plugin is the agent-facing half of "changeable by user OR the AI".
 */
export interface ModePluginOptions {
    getMode: () => AgentMode;
    /** Propose a mode to the user (surfaced, NOT applied — only the user switches). */
    suggestMode: (mode: AgentMode, reason?: string) => void;
}

export default class ModePlugin implements Plugin {
    name = 'ModePlugin';

    constructor(private readonly opts: ModePluginOptions) {}

    get tools(): Record<string, unknown> {
        return {
            suggest_mode: tool({
                description:
                    'SUGGEST an execution-mode switch to the user — you do NOT change it yourself; only the ' +
                    'user applies it (shift+tab). plan = read-only planning; manual = each edit/command asks first; ' +
                    'auto-edit = edits apply, shell/delegation ask; auto = act freely. Use this to recommend a mode ' +
                    '(e.g. "your plan is approved — suggest auto-edit to build it"), then wait for the user to switch.',
                inputSchema: z.object({
                    mode: z.enum(AGENT_MODES as unknown as [AgentMode, ...AgentMode[]]),
                    reason: z.string().describe('Required: one line on why you recommend this mode.'),
                }),
                execute: async ({ mode, reason }) => {
                    const current = this.opts.getMode();
                    this.opts.suggestMode(mode, reason);
                    return {
                        ok: true,
                        current,
                        suggested: mode,
                        note: `Suggested "${mode}" to the user — you are still in "${current}". They decide whether to switch (shift+tab); do not assume it changed.`,
                    };
                },
            }),
        };
    }

    modifySystemPrompt(prompt: string): string {
        return `${prompt}

## Execution mode
You run in one of four modes; the current mode gates your mutating tools:
- **plan** — planning is the job. File edits and shell are blocked, but planning
  is NOT: investigate with read-only tools, then present your plan by calling
  \`request_plan_review\` with it directly (title + solution, plus phases/etc).
  You do NOT need create_plan first, and "can't write files" does NOT mean "can't
  make a plan" — putting the plan up for review is exactly what you do here.
- **manual** — every file edit / shell command / delegation asks the user first.
- **auto-edit** — file edits apply automatically; shell and delegation still ask.
- **auto** — you act without asking.

You do NOT control the mode — only the user does (shift+tab, the menu, or by
approving a plan).

In **manual** and **auto-edit**, just call the tool you need — the harness shows
the user an approve/deny prompt on your behalf; that IS how permission gets
asked. Do NOT ask in prose ("should I edit X?") and do NOT push a mode switch to
avoid being asked.

In **plan** mode, present the plan with \`request_plan_review\` and stop. When the
user approves, they pick an execution mode right there (auto-edit or manual), so
you'll already have been switched over — just proceed. Do NOT call \`suggest_mode\`
for that, and do not retry blocked tools in a loop while you wait. \`suggest_mode\`
is a last resort for when the current mode is genuinely wrong for what the user
asked; otherwise leave the mode alone.`;
    }
}
