/// <reference types="bun-types" />

import { openai } from '@ai-sdk/openai';
import {
    SkillsPlugin,
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
import SqliteBackend from './src/backend/sqlitebackend';
import {
    AgentState,
    AgentDataParts,
    AgentUIMessage,
    VibeAgentConfig,
    SubAgent,
    TaskItem,
    TaskTemplate,
    VibesDataParts,
    VibesUIMessage,
    createDataStreamWriter,
    DataStreamWriter,
} from './src/core/types';
import { VibeAgent } from './src/core/agent';
export { createDeepAgentStreamResponse } from './src/core/agent-stream';

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

/**
 * DeepAgent is a sophisticated AI agent framework built on Vercel AI SDK v6.
 * It supports multi-step reasoning, persistent state with task dependencies,
 * real filesystem access, modular skills, and sub-agent delegation.
 */
export class DeepAgent extends VibeAgent {
    /**
     * Initializes a new DeepAgent instance.
     * @param config Optional configuration to customize model, prompt, and plugins.
     */
    constructor(config: DeepAgentConfig = {}) {
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
        - \`delegate_task\` / \`delegate_parallel\`: Spawn specialized sub-agents for parallel or complex work.
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
    - **Sub-Agent Results**: Results are saved to \`subagent_results/\`. ALWAYS read them to understand delegated work.
    - **Minimalism**: Make direct, necessary changes. Avoid over-engineering or unnecessary refactors.
    - **Learning from Error**: If a tool fails twice with the same error, you MUST stop and use \`reflexion_analyze_errors\`.
</rules>`;

        super({
            model: config.model || openai('gpt-4o'),
            instructions: baseInstructions,
            ...config,
        });

        // Initialize built-in plugins
        this.initializePlugins(config);
    }

    private initializePlugins(config: DeepAgentConfig): void {
        const skipDefaults = config.skipDefaultPlugins === true;
        const workspaceDir = config.workspaceDir || 'workspace';

        if (!skipDefaults) {
            this.addPlugin([
                // PlanningPlugin extends TasksPlugin with deep agent features:
                // - Task recitation (always-in-view current plan)
                // - Plan save/load from filesystem
                // - Hierarchical task support
                new PlanningPlugin(this.model, {
                    planPath: `${workspaceDir}/plan.md`,
                    maxRecitationTasks: 10,
                }),
                // ReasoningPlugin provides multiple reasoning patterns:
                // - ReAct: Think-act loop (default)
                // - ToT: Tree-of-Thoughts for parallel exploration
                // - Plan-Execute: Separate planning and execution phases
                new ReasoningPlugin(this.model, {
                    initialMode: 'tot',
                    maxBranches: 5,
                    autoExplore: true,
                    complexityThreshold: 5,
                }),
                // ReflexionPlugin adds self-improvement capabilities:
                // - Automatic error analysis and lesson extraction
                // - Structured lesson storage with metadata
                // - Contextual lesson retrieval and suggestion
                new ReflexionPlugin(this.model, {
                    maxLessons: 100,
                    lessonsPath: `${workspaceDir}/lessons.json`,
                    autoAnalyzeErrors: true,
                    analysisThreshold: 2,
                    autoSuggestLessons: true,
                }),
                // SemanticMemoryPlugin provides vector-based fact storage:
                // - Store facts with optional embeddings for semantic search
                // - Retrieve relevant facts by meaning (RAG-style memory)
                // - Keyword-based fallback when embeddings unavailable
                // - Persistent storage to workspace/facts.json
                new SemanticMemoryPlugin(undefined, {
                    maxFacts: 200,
                    factsPath: `${workspaceDir}/facts.json`,
                    similarityThreshold: 0.3,
                    autoExtract: true,
                }),
                // ProceduralMemoryPlugin stores reusable patterns and workflows:
                // - Store successful approaches as reusable patterns
                // - Retrieve relevant patterns by context
                // - Track pattern success rates over time
                // - Persistent storage to workspace/patterns.json
                new ProceduralMemoryPlugin(this.model, {
                    maxPatterns: 50,
                    patternsPath: `${workspaceDir}/patterns.json`,
                    autoSuggest: true,
                }),
                // SwarmPlugin enables decentralized multi-agent collaboration:
                // - Shared state between agents
                // - Signaling between agents
                // - Task proposal and claiming for swarm coordination
                // - Persistent swarm state
                new SwarmPlugin(
                    config.swarmId || config.sessionId || 'default',
                    {
                        maxStateEntries: 100,
                        maxSignalHistory: 50,
                        statePath: `${workspaceDir}/swarm-state.json`,
                        persistState: true,
                    }
                ),
                new SkillsPlugin(),
                new FilesystemPlugin({ baseDir: workspaceDir }),
                new BashPlugin(workspaceDir),
                new MemoryPlugin()
            ])
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
            () => this.getAllTools(),
            () => this.plugins,
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
    type AgentDataParts,
    type AgentUIMessage,
    type TaskItem,
    type TaskTemplate,
    type VibesDataParts,
    type VibesUIMessage,
    createDataStreamWriter,
    DataStreamWriter,
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
    VibeAgent, // Old implementation (to be deprecated)
    VibeAgent as VibesAgent, // Alias for backwards compatibility with tests
};
