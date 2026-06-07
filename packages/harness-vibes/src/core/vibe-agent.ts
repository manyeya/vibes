import * as path from 'path';
import { type LanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
    SkillsPlugin,
    PlanningPlugin,
    FilesystemPlugin,
    BashPlugin,
    SubAgentPlugin,
    SummarizationPlugin,
    ArtifactPlugin,
    ClarificationPlugin,
    WebSearchPlugin,
} from '../plugins';
import MemoryPlugin from '../plugins/memory';
import {
    AgentCoreConfig,
    SubAgent,
    Plugin,
    ToolsRequiringApprovalConfig,
} from './types';
import { AgentCore } from './agent-core';
import type { Sandbox } from './sandbox';

/**
 * Configuration for initializing a VibeAgent instance.
 */
export interface VibeAgentConfig extends Partial<Omit<AgentCoreConfig, 'instructions'>> {
    /** Custom instructions to extend the base system prompt */
    systemPrompt?: string;
    /** Registry of sub-agents available for delegation */
    subAgents?: SubAgent[];
    /** If true, standard plugins (Tasks, Skills, Filesystem) will not be loaded */
    skipDefaultPlugins?: boolean;
    /** Optional shared state backend for state inheritance (used in sub-agents) */
    backend?: any;
    /** Unique session identifier for persistent SQLite storage */
    sessionId?: string;
    /** Path to the SQLite database file (default: workspace/vibes.db) */
    dbPath?: string;
    /**
     * Optional {@link Sandbox} backing the filesystem + shell plugins. When
     * omitted, those plugins fall back to a LocalSandbox rooted at
     * `workspaceDir`. Provide a sandbox to isolate or relocate execution
     * (e.g. a virtual or remote sandbox).
     */
    sandbox?: Sandbox;
}

export interface DefaultPluginFactoryOptions {
    model: LanguageModel;
    workspaceDir: string;
    sessionId?: string;
    /** Sandbox shared by the filesystem + bash plugins for this agent. */
    sandbox?: Sandbox;
    /** Model context window (tokens) — drives token-based summarization. */
    contextWindow?: number;
    /** Fraction of the window at which summarization triggers (0–1). */
    compressionRatio?: number;
}

function resolveSharedWorkspaceDir(workspaceDir: string): string {
    const normalized = path.normalize(workspaceDir);
    const parentDir = path.dirname(normalized);

    if (path.basename(parentDir) === 'sessions') {
        return path.dirname(parentDir);
    }

    return normalized;
}

export function createDefaultPlugins(config: DefaultPluginFactoryOptions): Plugin[] {
    const sharedWorkspaceDir = resolveSharedWorkspaceDir(config.workspaceDir);

    const plugins: Plugin[] = [
        new PlanningPlugin(config.model, {
            planPath: path.join(config.workspaceDir, 'plan.md'),
            tasksPath: path.join(config.workspaceDir, 'tasks.json'),
            maxRecitationTasks: 10,
        }),
        new SkillsPlugin(),
        // Filesystem + Bash run through the shared Sandbox when provided,
        // otherwise each constructs a LocalSandbox rooted at workspaceDir.
        new FilesystemPlugin({ baseDir: config.workspaceDir, sandbox: config.sandbox }),
        new BashPlugin(config.sandbox ? { sandbox: config.sandbox } : config.workspaceDir),
        // Renderable artifacts (websites, docs, diagrams, charts) → canvas panel.
        new ArtifactPlugin({ baseDir: config.workspaceDir, sandbox: config.sandbox }),
        // Ask the user structured clarifying questions (questionnaire above the composer).
        new ClarificationPlugin(),
        new MemoryPlugin({
            scratchpadPath: path.join(config.workspaceDir, 'scratchpad.md'),
            notesPath: path.join(sharedWorkspaceDir, 'memories.json'),
        }),
        // Rolling-summary plugin: keeps long conversations within token
        // budget by summarising the oldest excess messages once we exceed
        // 1.5x its threshold. Triggers before the agent's pruneMessages
        // fallback truncation.
        new SummarizationPlugin(config.model, {
            contextWindow: config.contextWindow,
            compressionRatio: config.compressionRatio,
        }),
    ];

    // Web search (Exa / Tavily / Brave) — only when a provider key is set, so
    // the agent isn't handed a tool that can only error.
    const webSearch = new WebSearchPlugin();
    if (webSearch.isEnabled) plugins.push(webSearch);

    return plugins;
}

/**
 * Plugins for a **sub-agent** — a focused worker, not a second brain.
 *
 * Deliberately lean: filesystem, shell, skills, artifacts and planning only.
 * The heavy cognitive/orchestration plugins (Reasoning's auto tree-of-thoughts,
 * procedural memory, rolling summarization) are intentionally excluded — on a
 * delegated sub-task they bloat the system prompt and fire extra nested model
 * calls, which is exactly what made delegation slow and flaky. A sub-agent
 * should *do the task* with real tools and report back, not re-run the whole
 * planning stack.
 */
export function createSubAgentPlugins(config: DefaultPluginFactoryOptions): Plugin[] {
    const plugins: Plugin[] = [
        new PlanningPlugin(config.model, {
            planPath: path.join(config.workspaceDir, 'plan.md'),
            tasksPath: path.join(config.workspaceDir, 'tasks.json'),
            maxRecitationTasks: 10,
        }),
        new SkillsPlugin(),
        new FilesystemPlugin({ baseDir: config.workspaceDir, sandbox: config.sandbox }),
        new BashPlugin(config.sandbox ? { sandbox: config.sandbox } : config.workspaceDir),
        new ArtifactPlugin({ baseDir: config.workspaceDir, sandbox: config.sandbox }),
    ];

    // Research-capable workers get web search too, when configured.
    const webSearch = new WebSearchPlugin();
    if (webSearch.isEnabled) plugins.push(webSearch);

    return plugins;
}

/**
 * VibeAgent is a sophisticated AI agent framework built on Vercel AI SDK v6.
 * It supports multi-step reasoning, persistent state with task dependencies,
 * real filesystem access, modular skills, and sub-agent delegation.
 */
export class VibeAgent extends AgentCore {
    private readonly vibeAgentConfig: VibeAgentConfig;
    private readonly parentCustomTools: Record<string, any>;
    private readonly parentApprovalConfig: ToolsRequiringApprovalConfig;

    /**
     * Initializes a new VibeAgent instance.
     * @param config Optional configuration to customize model, prompt, and plugins.
     */
    constructor(config: VibeAgentConfig = {}) {
        const normalizedConfig = { ...config };
        const baseInstructions = `<identity>
    You are VibeAgent, a sophisticated autonomous AI agent built on the Vibes framework. You specialize in systematic planning, deep reasoning, and high-fidelity execution across complex software projects.
</identity>

<mindset>
    - **Plan First**: Never code blindly. Use \`generate_tasks\` to build a roadmap for complex requests.
    - **Incremental Progress**: Tackle one task at a time. Mark it \`in_progress\`, complete it, then move on.
</mindset>

<extensible_capabilities>
    You are extensible via a plugin-driven architecture. Your tools reflect these capabilities:

    <capability name="Planning & Tasks">
        - use \`generate_tasks\` to decompose requests into actionable steps.
        - use \`update_task\` to manage workflow state (in_progress, completed).
        - use \`get_next_tasks\` and \`list_tasks\` to maintain focus.
    </capability>

    <capability name="OS & Environment">
        - \`bash\`: Full shell access for exploration, searching (grep, find), and advanced commands.
        - \`readFile\` / \`writeFile\`: Direct workspace filesystem management.
        - \`list_files\`: Discover project structure recursively.
    </capability>

    <capability name="Multi-Agent Collaboration">
        - \`delegate\` / \`parallel_delegate\`: Spawn specialized sub-agents for parallel or complex work.
    </capability>
</extensible_capabilities>

<standard_workflow>
    1. **Understand**: Read the request and relevant files using \`readFile\` or \`list_files\`.
    2. **Decompose**: Call \`generate_tasks\` with a specific file-based plan.
    3. **Execute**:
        - Pick the next available task; mark it \`in_progress\` via \`update_task\`.
        - Perform work (code edits, shell commands).
    4. **Verify**: Use \`bash\` to run tests or \`readFile\` to confirm your changes are correct.
    5. **Complete**: Mark task \`completed\` via \`update_task\`.
</standard_workflow>

<rules>
    - **Specific Tasks**: Tasks MUST include file paths. BAD: "fix bug". GOOD: "Update validation() in src/auth.ts".
    - **Read Before Write**: Always read a file before modifying it to ensure context is accurate.
    - **Sub-Agent Results**: Use the structured delegation result first. Read the artifact in \`subagent_results/\` only when the summary is insufficient or you need audit/debug detail.
    - **Minimalism**: Make direct, necessary changes. Avoid over-engineering or unnecessary refactors.
    - **Learning from Error**: If a tool fails twice with the same error, stop and rethink your approach instead of retrying blindly.
</rules>`;

        super({
            model: normalizedConfig.model || openai('gpt-4o'),
            instructions: baseInstructions,
            ...normalizedConfig,
        });

        this.vibeAgentConfig = normalizedConfig;
        this.parentCustomTools = { ...(normalizedConfig.tools ?? {}) };
        this.parentApprovalConfig = normalizedConfig.toolsRequiringApproval ?? [];

        // Initialize built-in plugins
        this.initializePlugins(normalizedConfig);
    }

    private initializePlugins(config: VibeAgentConfig): void {
        const skipDefaults = config.skipDefaultPlugins === true;
        const workspaceDir = config.workspaceDir || 'workspace';

        if (!skipDefaults) {
            this.addPlugin(createDefaultPlugins({
                model: this.model,
                workspaceDir,
                sessionId: config.sessionId,
                sandbox: config.sandbox,
                contextWindow: this.contextWindow,
                compressionRatio: this.contextCompressionRatio,
            }));
        }

        // SubAgent plugin
        const subAgentMap = new Map<string, SubAgent>();

        if (config.subAgents) {
            config.subAgents.forEach(agent => {
                subAgentMap.set(agent.name, agent);
            });
        }

        // NOTE: sub-agents derive their own LocalSandbox from their per-agent
        // workspace dir for now. A shared virtual/remote sandbox would need to
        // be threaded here too — tracked as a follow-up for Phase 3.
        this.addPlugin(new SubAgentPlugin(
            subAgentMap,
            this.model,
            // Sub-agents run the LEAN plugin set, not the full default stack.
            ({ model, workspaceDir: subAgentWorkspaceDir }) => createSubAgentPlugins({
                model: model || this.model,
                workspaceDir: subAgentWorkspaceDir || workspaceDir,
                sessionId: this.vibeAgentConfig.sessionId,
            }),
            () => ({ ...this.parentCustomTools }),
            this.parentApprovalConfig,
            workspaceDir
        ))

        // Custom plugins
        if (config.plugins) {
            this.addPlugin([...config.plugins]);
        }
    }
}

/**
 * Factory function to create a VibeAgent instance.
 * @param config Agent configuration object.
 */
export function createVibeAgent(config: VibeAgentConfig = {}): VibeAgent {
    return new VibeAgent(config);
}
