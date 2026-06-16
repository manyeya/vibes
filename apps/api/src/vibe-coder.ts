/**
 * Agent factory. Builds VibeAgent instances for a given session, fully
 * decoupled from the in-memory registry and HTTP layer so tests and
 * alternative entry points can construct agents directly.
 *
 * Owns:
 *   - The default sub-agent roster (explore, architect, implementer, …)
 *   - The default agent prompt + step/context limits
 *   - The model resolution path (currently delegates to a model factory)
 *   - Workspace setup for new sessions
 */

import { createHarness, type Harness, ASK_USER_TOOL_NAME, PLAN_REVIEW_TOOL_NAME } from '../../../packages/harness-vibes/index';
import type { SubAgent } from '../../../packages/harness-vibes/index';
import { wrapLanguageModel, hasToolCall, type LanguageModel } from 'ai';
import { devToolsMiddleware } from '@ai-sdk/devtools';
import { vibePrompt } from './prompts/vibe';
import { getModel, getContextWindow, getDefaultModelId } from './model-factory';
import { dotenvLoad } from 'dotenv-mono';

// Load env (API keys, etc.) before the harness resolves its model below.
dotenvLoad();

/**
 * The default roster of sub-agents shipped with every Vibe session.
 * Tools listed in `allowedTools` must exist on the parent agent — they
 * are inherited via the SubAgentPlugin's tool whitelist mechanism.
 */
export const defaultSubAgents: SubAgent[] = [
    {
        name: 'explore',
        description: 'Read-only codebase explorer. Fans out across files to locate code, map structure, and report findings — never edits.',
        systemPrompt: `You are explore, a fast read-only codebase navigator.
Given a question, sweep the workspace and return the CONCLUSION — which files/symbols matter and how they fit together — not a file dump.
- Read and search with bash: \`ls\`, \`find\`, \`rg\`/\`grep\`, \`cat\`, \`sed -n '10,40p'\`. Read excerpts, not whole files, unless necessary.
- Trace the relevant code paths and note key file:line locations.
- Do NOT modify anything. Hand back a tight summary an engineer can act on immediately.`,
        mode: 'general-purpose',
        allowedTools: ['bash'],
        allowSubdelegation: false,
        artifactMode: 'errors-only',
    },
    {
        name: 'architect',
        description: 'Designs the implementation approach for a task — trade-offs, a file-by-file plan, and risks. Produces a plan, not code.',
        systemPrompt: `You are architect, a senior software architect. You design HOW to build something; you do not implement it.
- Read the relevant code first (bash); use webSearch for unfamiliar libraries or APIs.
- Produce: the approach, the concrete file-by-file changes, the key trade-offs you weighed (A vs B), edge cases, and risks.
- Be specific and buildable — another agent should be able to execute your plan directly without re-deciding anything.`,
        mode: 'general-purpose',
        allowedTools: ['bash', 'webSearch'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
    {
        name: 'implementer',
        description: 'Writes and edits code to implement a well-scoped change end to end, then verifies it.',
        systemPrompt: `You are implementer, a precise senior engineer. Given a well-scoped task, make the change end to end.
- Read the surrounding code first and match its style and conventions.
- Edit existing files with \`edit_file\` (exact, reliable — no sed escaping); create new files via bash heredocs.
- Keep changes minimal and focused; no drive-by refactors.
- Verify with bash (run any available checks; re-read what you changed). Report what you changed and how you verified it.`,
        mode: 'general-purpose',
        allowedTools: ['bash', 'edit_file', 'skill'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
    {
        name: 'reviewer',
        description: 'Reviews a change for correctness bugs and quality issues, with specific, actionable findings.',
        systemPrompt: `You are reviewer, a sharp code reviewer. Review the change in question for REAL problems, not style nits.
- Inspect the code and any diffs with bash (\`git\` is unavailable — use \`diff\`, \`cat\`, \`rg\`).
- Hunt first for correctness bugs, broken edge cases, security issues, and unhandled errors; then reuse/simplification.
- Report findings as a tight list — file:line, the problem, and a concrete fix. Say plainly if it looks correct.
- Only edit (\`edit_file\`) if you are explicitly asked to apply the fixes.`,
        mode: 'general-purpose',
        allowedTools: ['bash', 'edit_file'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
    {
        name: 'debugger',
        description: 'Diagnoses a failure (error, crash, failing check) to its root cause and fixes it.',
        systemPrompt: `You are debugger, a relentless root-cause analyst. Find WHY a failure happens and fix it — never paper over symptoms.
- Reproduce/inspect with bash; read the failing code and trace the data and control flow.
- Form a hypothesis, confirm it against the code, then apply the MINIMAL fix with \`edit_file\`.
- Verify the failure is actually resolved. Report the root cause, the fix, and how you verified it.`,
        mode: 'general-purpose',
        allowedTools: ['bash', 'edit_file'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
    {
        name: 'researcher',
        description: 'Researches external / up-to-date information on the web and synthesizes a sourced answer.',
        systemPrompt: `You are researcher, a careful web researcher. Answer questions that depend on current, external facts (libraries, APIs, best practices).
- Use webSearch; prefer primary and recent sources, and cross-check claims.
- Cite the useful sources by URL. Synthesize a direct, accurate answer and flag uncertainty rather than guessing.`,
        mode: 'general-purpose',
        allowedTools: ['webSearch', 'bash'],
        allowSubdelegation: false,
        artifactMode: 'errors-only',
    },
];

/**
 * Resolve the base model from env (model-factory) and wrap it with the AI
 * SDK devtools middleware.
 */
function buildVibeModel(): LanguageModel {
    const baseModel = getModel();
    // `LanguageModel = string | LanguageModelV3 | LanguageModelV2` in AI
    // SDK v6. Our model factory returns concrete provider instances, but
    // some legacy providers (e.g. zhipu-ai-provider) still emit V2. We pass
    // through a single boundary cast here rather than spreading
    // version-specific branching through the wrap call site.
    type WrappableModel = Parameters<typeof wrapLanguageModel>[0]['model'];
    return wrapLanguageModel({
        model: baseModel as unknown as WrappableModel,
        middleware: devToolsMiddleware(),
    });
}

/**
 * The Vibe harness — the single owner of sessions for the API.
 *
 * `vibeHarness.session(id)` builds (once, then caches) a flagship VibeAgent
 * rooted at a per-session `LocalSandbox` + SQLite-backed workspace. The HTTP
 * layer routes everything stateful through this; it does not cache agents or
 * open backends itself.
 */
export const vibeHarness: Harness = createHarness(
    {
        model: buildVibeModel(),
        systemPrompt: vibePrompt,
        maxSteps: 60,
        // Token-based context compression: summarize the oldest history once the
        // conversation passes 70% of the model's real context window.
        contextWindow: getContextWindow(getDefaultModelId()),
        contextCompressionRatio: 0.7,
        // Hand control back to the user when the agent asks a question
        // (`ask_user`) or puts a plan up for approval (`request_plan_review`):
        // the run halts so the user can answer / approve before it continues.
        stopWhen: [hasToolCall(ASK_USER_TOOL_NAME), hasToolCall(PLAN_REVIEW_TOOL_NAME)],
        // `webSearch` is now provided by the WebSearchPlugin (default + sub-agent
        // plugin sets), which auto-detects a provider from EXA_API_KEY /
        // TAVILY_API_KEY / BRAVE_API_KEY and streams a sources card.
        subAgents: defaultSubAgents,

    },
    {
        dbPath: 'workspace/vibes.db',
        sessionsDir: 'workspace/sessions',
        // Workspaces (projects) get an app-managed shared dir under here; all
        // sessions in a workspace root their sandbox at workspace/projects/{id}.
        projectsDir: 'workspace/projects',
    },
);
