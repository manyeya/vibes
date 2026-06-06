/**
 * Agent factory. Builds VibeAgent instances for a given session, fully
 * decoupled from the in-memory registry and HTTP layer so tests and
 * alternative entry points can construct agents directly.
 *
 * Owns:
 *   - The default sub-agent roster (Planner, Librarian, etc.)
 *   - The default agent prompt + step/context limits
 *   - The model resolution path (currently delegates to a model factory)
 *   - Workspace setup for new sessions
 */

import { createHarness, type Harness } from '../../../packages/harness-vibes/index';
import type { SubAgent } from '../../../packages/harness-vibes/index';
import { wrapLanguageModel, type LanguageModel } from 'ai';
import { devToolsMiddleware } from '@ai-sdk/devtools';
import { webSearch } from '@exalabs/ai-sdk';
import { vibePrompt } from './prompts/vibe';
import { getModel } from './model-factory';
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
        name: 'Planner',
        description: 'Specialized in high-level task breakdown, recursive execution, and progress tracking.',
        systemPrompt: `You are Planner, the strategic logical core of the team.
        Your role is to break complex requests into exhaustive, actionable todo lists.`,
        mode: 'general-purpose',
        allowedTools: ['create_plan', 'generate_tasks', 'update_task', 'get_next_tasks', 'list_tasks', 'readFile', 'writeFile'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
    {
        name: 'Librarian',
        description: 'Focused on codebase documentation, design patterns, and systemic context.',
        systemPrompt: `You are Librarian. Your role is to maintain the "Source of Truth" for the project.`,
        mode: 'general-purpose',
        allowedTools: ['readFile', 'list_files'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
    {
        name: 'Explorer',
        description: 'Specialized in navigating large codebases and finding relevant files/logic.',
        systemPrompt: `You are Explorer. Your role is to map out the codebase and find exactly what is needed.`,
        mode: 'general-purpose',
        allowedTools: ['readFile', 'list_files', 'bash'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
    {
        name: 'Oracle',
        description: 'RAG-based knowledge retrieval and expert Q&A for the codebase.',
        systemPrompt: `You are Oracle. Your role is to answer complex questions about the system logic and architecture.`,
        mode: 'general-purpose',
        allowedTools: ['readFile', 'list_files', 'webSearch'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
    {
        name: 'SuperCoder',
        description: 'Elite Front End UI/UX Engineer and Creative Technologist.',
        systemPrompt: `You are SuperCoder, the master of implementation. Focus on stunning visuals, fluid interactions, and flawless performance.`,
        mode: 'general-purpose',
        allowedTools: ['readFile', 'writeFile', 'list_files', 'bash', 'activate_skill'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
    {
        name: 'BrowserAgent',
        description: 'Browser Automation with agent-browser for research and testing.',
        systemPrompt: `You are BrowserAgent. Your role is to interact with the web and verify the UI.`,
        mode: 'general-purpose',
        allowedTools: ['bash', 'activate_skill', 'readFile', 'writeFile'],
        allowSubdelegation: false,
        artifactMode: 'always',
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
        // Verbatim window kept by the agent's pruneMessages fallback;
        // SummarizationPlugin trims earlier history before this threshold.
        maxSteps: 60,
        maxContextMessages: 50,
        tools: {
            webSearch: webSearch() as any,
        },
        subAgents: defaultSubAgents,
     
    },
    {
        dbPath: 'workspace/vibes.db',
        sessionsDir: 'workspace/sessions',
    },
);
