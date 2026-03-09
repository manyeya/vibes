// Bun types are only available in Bun runtime
// This file doesn't use Bun-specific APIs directly, so no reference needed

import * as path from 'path';
import { type LanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
    SkillsPlugin,
    TasksPlugin,
    PlanningPlugin,
    ReasoningPlugin,
    ReflexionPlugin,
    SemanticMemoryPlugin,
    ProceduralMemoryPlugin,
    SwarmPlugin,
    FilesystemPlugin,
    BashPlugin,
    SubAgentPlugin,
    AgentSignal,
    ProceduralMemoryConfig,
    SharedStateEntry,
    SwarmConfig,
    ParallelDelegationResult,
    FactMatch,
    SemanticMemoryConfig,
    ReflexionConfig,
    Pattern,
    ReasoningMode,
    ReasoningConfig,
    Lesson,
    ErrorAnalysis,
    Fact,
    PatternApplication,
} from './src/plugins';
import MemoryPlugin from './src/plugins/memory';
import SqliteBackend from './src/persistence/sqlite-backend';
import {
    AgentState,
    VibeAgentConfig,
    SubAgent,
    Plugin,
    TaskItem,
    TaskTemplate,
    TaskType,
    VibesDataParts,
    VibesUIMessage,
    createDataStreamWriter,
    DataStreamWriter,
    ToolsRequiringApprovalConfig,
} from './src/core/types';
import { VibeAgent } from './src/core/agent';
export { createDeepAgentStreamResponse } from './src/core/agent-stream';
export {
    HarnessSessionManager as SessionManager,
    defaultSessionManager,
    type SessionConfig,
    type SessionInstance,
    type SessionAgentConfig,
    type CleanupOptions,
} from './src/session/session-manager';

/**
 * Configuration for initializing a DeepAgent instance.
 */
interface DeepAgentConfig extends Partial<Omit<VibeAgentConfig, 'instructions'>> {
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
    /** Unique identifier for this agent in a swarm (used for swarm coordination) */
    swarmId?: string;
}

interface DefaultPluginFactoryOptions {
    model: LanguageModel;
    workspaceDir: string;
    sessionId?: string;
    swarmId?: string;
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

    return [
        new PlanningPlugin(config.model, {
            planPath: path.join(config.workspaceDir, 'plan.md'),
            tasksPath: path.join(config.workspaceDir, 'tasks.json'),
            maxRecitationTasks: 10,
        }),
        new ReasoningPlugin(config.model, {
            initialMode: 'tot',
            maxBranches: 5,
            autoExplore: true,
            complexityThreshold: 5,
        }),
        new ReflexionPlugin(config.model, {
            maxLessons: 100,
            lessonsPath: path.join(sharedWorkspaceDir, 'lessons.json'),
            autoAnalyzeErrors: true,
            analysisThreshold: 2,
            autoSuggestLessons: true,
        }),
        new SemanticMemoryPlugin(undefined, {
            maxFacts: 200,
            factsPath: path.join(sharedWorkspaceDir, 'facts.json'),
            similarityThreshold: 0.3,
            autoExtract: true,
        }),
        new ProceduralMemoryPlugin(config.model, {
            maxPatterns: 50,
            patternsPath: path.join(sharedWorkspaceDir, 'patterns.json'),
            autoSuggest: true,
        }),
        new SwarmPlugin(
            config.swarmId || config.sessionId || 'default',
            {
                maxStateEntries: 100,
                maxSignalHistory: 50,
                statePath: path.join(sharedWorkspaceDir, 'swarm-state.json'),
                persistState: true,
            }
        ),
        new SkillsPlugin(),
        new FilesystemPlugin({ baseDir: config.workspaceDir }),
        new BashPlugin(config.workspaceDir),
        new MemoryPlugin({
            scratchpadPath: path.join(config.workspaceDir, 'scratchpad.md'),
            reflexionPath: path.join(sharedWorkspaceDir, 'reflections.md'),
        }),
    ];
}

/**
 * DeepAgent is a sophisticated AI agent framework built on Vercel AI SDK v6.
 * It supports multi-step reasoning, persistent state with task dependencies,
 * real filesystem access, modular skills, and sub-agent delegation.
 */
export class DeepAgent extends VibeAgent {
    private readonly deepAgentConfig: DeepAgentConfig;
    private readonly parentCustomTools: Record<string, any>;
    private readonly parentApprovalConfig: ToolsRequiringApprovalConfig;

    /**
     * Initializes a new DeepAgent instance.
     * @param config Optional configuration to customize model, prompt, and plugins.
     */
    constructor(config: DeepAgentConfig = {}) {
        const normalizedConfig = { ...config };
        const baseInstructions = `<identity>
    You are DeepAgent, a sophisticated autonomous AI agent built on the Vibes framework. You specialize in systematic planning, deep reasoning, and high-fidelity execution across complex software projects.
</identity>

<mindset>
    - **Plan First**: Never code blindly. Use \`generate_tasks\` to build a roadmap for complex requests.
    - **Incremental Progress**: Tackle one task at a time. Mark it \`in_progress\`, complete it, then move on.
    - **Deep Reasoning**: For complex problems, use \`reasoning_mode\` to explore multiple paths or decouple strategy from action.
    - **Self-Correction**: Use \`reflexion_analyze_errors\` to learn from failures. Apply learned lessons to avoid repeating mistakes.
    - **Memory-Augmented**: Use \`store_fact\` for persistent knowledge and \`store_pattern\` for reusable workflows.
</mindset>

<extensible_capabilities>
    You are extensible via a plugin-driven architecture. Your tools reflect these capabilities:

    <capability name="Planning & Tasks">
        - use \`generate_tasks\` to decompose requests into actionable steps.
        - use \`update_task\` to manage workflow state (in_progress, completed).
        - use \`get_next_tasks\` and \`list_tasks\` to maintain focus.
    </capability>

    <capability name="Reasoning Modes">
        - \`react\`: Standard Think-Act-Observe loop.
        - \`tot\`: Tree-of-Thoughts for parallel exploration of solutions.
        - \`plan-execute\`: Strategic planning followed by batch execution.
    </capability>

    <capability name="Reflexion & Learning">
        - Analyze errors with \`reflexion_analyze_errors\`.
        - Extract insights with \`reflexion_add_lesson\`.
        - View history with \`reflexion_summarize_session\`.
    </capability>

    <capability name="Memory Systems">
        - Semantic (Facts): \`store_fact\`, \`search_facts\`, \`list_facts\`.
        - Procedural (Patterns): \`store_pattern\`, \`search_patterns\`, \`analyze_successful_approach\`.
    </capability>

    <capability name="OS & Environment">
        - \`bash\`: Full shell access for exploration, searching (grep, find), and advanced commands.
        - \`readFile\` / \`writeFile\`: Direct workspace filesystem management.
        - \`list_files\`: Discover project structure recursively.
    </capability>

    <capability name="Multi-Agent Collaboration">
        - \`swarm\`: Share state and signal other agents via \`swarm_set_state\`, \`swarm_send_signal\`, and \`swarm_propose_task\`.
        - \`delegate\` / \`parallel_delegate\`: Spawn specialized sub-agents for parallel or complex work.
    </capability>
</extensible_capabilities>

<standard_workflow>
    1. **Understand**: Read the request and relevant files using \`readFile\` or \`list_files\`.
    2. **Decompose**: Call \`generate_tasks\` with a specific file-based plan.
    3. **Execute**:
        - Pick the next available task; mark it \`in_progress\` via \`update_task\`.
        - Perform work (code edits, shell commands).
        - If stuck, use \`reasoning_mode('tot')\` or \`search_patterns\`.
    4. **Verify**: Use \`bash\` to run tests or \`readFile\` to confirm your changes are correct.
    5. **Complete**: Mark task \`completed\` via \`update_task\`.
    6. **Reflect**: If errors occurred, use \`reflexion_analyze_errors\` before proceeding.
</standard_workflow>

<rules>
    - **Specific Tasks**: Tasks MUST include file paths. BAD: "fix bug". GOOD: "Update validation() in src/auth.ts".
    - **Read Before Write**: Always read a file before modifying it to ensure context is accurate.
    - **Sub-Agent Results**: Use the structured delegation result first. Read the artifact in \`subagent_results/\` only when the summary is insufficient or you need audit/debug detail.
    - **Minimalism**: Make direct, necessary changes. Avoid over-engineering or unnecessary refactors.
    - **Learning from Error**: If a tool fails twice with the same error, you MUST stop and use \`reflexion_analyze_errors\`.
</rules>`;

        super({
            model: normalizedConfig.model || openai('gpt-4o'),
            instructions: baseInstructions,
            ...normalizedConfig,
        });

        this.deepAgentConfig = normalizedConfig;
        this.parentCustomTools = { ...(normalizedConfig.tools ?? {}) };
        this.parentApprovalConfig = normalizedConfig.toolsRequiringApproval ?? [];

        // Initialize built-in plugins
        this.initializePlugins(normalizedConfig);
    }

    private initializePlugins(config: DeepAgentConfig): void {
        const skipDefaults = config.skipDefaultPlugins === true;
        const workspaceDir = config.workspaceDir || 'workspace';

        if (!skipDefaults) {
            this.addPlugin(createDefaultPlugins({
                model: this.model,
                workspaceDir,
                sessionId: config.sessionId,
                swarmId: config.swarmId,
            }));
        }

        // SubAgent plugin
        const subAgentMap = new Map<string, SubAgent>();

        if (config.subAgents) {
            config.subAgents.forEach(agent => {
                subAgentMap.set(agent.name, agent);
            });
        }

        this.addPlugin(new SubAgentPlugin(
            subAgentMap,
            this.model,
            ({ model, workspaceDir: subAgentWorkspaceDir }) => createDefaultPlugins({
                model: model || this.model,
                workspaceDir: subAgentWorkspaceDir || workspaceDir,
                sessionId: this.deepAgentConfig.sessionId,
                swarmId: this.deepAgentConfig.swarmId,
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
 * Factory function to create a DeepAgent instance.
 * @param config Agent configuration object.
 */
function createDeepAgent(config: DeepAgentConfig = {}): DeepAgent {
    return new DeepAgent(config);
}

export {
    type AgentState,
    type DeepAgentConfig,
    type TaskItem,
    type TaskTemplate,
    TaskType,
    type VibesDataParts,
    type VibesUIMessage,
    createDataStreamWriter,
    DataStreamWriter,
    TasksPlugin,
    PlanningPlugin,
    ReasoningPlugin,
    ReflexionPlugin,
    SemanticMemoryPlugin,
    ProceduralMemoryPlugin,
    SwarmPlugin,
    type ReasoningMode,
    type ReasoningConfig,
    type Lesson,
    type ErrorAnalysis,
    type ReflexionConfig,
    type Fact,
    type FactMatch,
    type SemanticMemoryConfig,
    type Pattern,
    type PatternApplication,
    type ProceduralMemoryConfig,
    type AgentSignal,
    type SharedStateEntry,
    type SwarmConfig,
    type ParallelDelegationResult,
    createDeepAgent,
    SqliteBackend,
    type VibeAgentConfig,
    type SubAgent,
    VibeAgent as VibesAgent, // Alias for backwards compatibility with tests
};
