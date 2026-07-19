import type { ToolApprovalPolicy } from '../types';

/**
 * Agent execution modes — a policy layer over the tool-approval gate.
 *
 *  - `plan`      : read-only. Mutating tools are BLOCKED; the agent investigates
 *                  and proposes a plan (request_plan_review) instead of editing.
 *  - `manual`    : every edit/exec tool asks the user for approval before running.
 *  - `auto-edit` : file edits apply automatically; shell + delegation still ask.
 *  - `auto`      : nothing asks — full autonomy (the historical default).
 *
 * Both the user (UI / API) and the agent (the `set_mode` tool) can switch modes;
 * changes take effect on the very next tool call because the approval predicate
 * and the execute guard read the current mode live (no tool-cache rebuild).
 */
export type AgentMode = 'plan' | 'manual' | 'auto-edit' | 'auto';

export const AGENT_MODES: readonly AgentMode[] = ['plan', 'manual', 'auto-edit', 'auto'];

export const isAgentMode = (v: unknown): v is AgentMode =>
    typeof v === 'string' && (AGENT_MODES as readonly string[]).includes(v);

/** Next mode in the cycle — drives the UI's shift+tab toggle. */
export const nextMode = (mode: AgentMode): AgentMode =>
    AGENT_MODES[(AGENT_MODES.indexOf(mode) + 1) % AGENT_MODES.length]!;

export const MODE_LABEL: Record<AgentMode, string> = {
    plan: 'plan',
    manual: 'manual',
    'auto-edit': 'auto-edit',
    auto: 'auto',
};

/** What a tool *does*, which decides whether a mode gates it. */
export type ToolClass = 'read' | 'edit' | 'exec';

// Explicit is safer than clever regex: an unknown (custom) tool falls through to
// `read` and is never gated. Tighten by adding names here if a custom tool
// mutates state and should respect modes.
const EDIT_TOOLS = new Set(['writeFile', 'edit_file', 'create_artifact', 'edit_artifact']);
const EXEC_TOOLS = new Set(['bash', 'delegate', 'parallel_delegate', 'task', 'spawn_agent', 'create_agent']);

export function classifyTool(name: string): ToolClass {
    if (EDIT_TOOLS.has(name)) return 'edit';
    if (EXEC_TOOLS.has(name)) return 'exec';
    return 'read';
}

export type ModeDecision = 'allow' | 'approve' | 'block';

/** The gate decision for a tool class under a mode. Read tools always run. */
export function modeDecision(mode: AgentMode, cls: ToolClass): ModeDecision {
    if (cls === 'read') return 'allow';
    switch (mode) {
        case 'auto':
            return 'allow';
        case 'auto-edit':
            return cls === 'edit' ? 'allow' : 'approve';
        case 'manual':
            return 'approve';
        case 'plan':
            return 'block';
    }
}

/**
 * A per-call approval predicate that ORs the tool's existing/base policy with
 * the current mode. Evaluated per invocation, so switching mode mid-run applies
 * immediately. Only attach to non-`read` tools.
 */
export function modeApprovalPolicy(
    getMode: () => AgentMode,
    cls: ToolClass,
    base: ToolApprovalPolicy | undefined,
): ToolApprovalPolicy {
    return async (input, context) => {
        if (base === true) return true;
        if (typeof base === 'function' && (await base(input, context))) return true;
        return modeDecision(getMode(), cls) === 'approve';
    };
}

type Execute = (args: unknown, options: unknown) => Promise<unknown>;

/**
 * Wrap a tool's execute so it short-circuits with an error result when the
 * current mode BLOCKS it (plan mode). The model reads the message and adapts
 * (proposes a plan) rather than the run halting or erroring out.
 */
export function guardModeBlock(
    getMode: () => AgentMode,
    toolName: string,
    cls: ToolClass,
    execute: Execute,
): Execute {
    return async (args, options) => {
        if (modeDecision(getMode(), cls) === 'block') {
            return {
                mode_blocked: true,
                mode: getMode(),
                message:
                    `"${toolName}" is disabled in plan mode. Investigate read-only, then propose a plan ` +
                    `with request_plan_review — or ask the user to switch out of plan mode.`,
            };
        }
        return execute(args, options);
    };
}
