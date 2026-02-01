/// <reference types="bun-types" />

import { openai } from '@ai-sdk/openai';
import {
    SkillsMiddleware,
    PlanningMiddleware,
    ReasoningMiddleware,
    ReflexionMiddleware,
    SemanticMemoryMiddleware,
    ProceduralMemoryMiddleware,
    SwarmMiddleware,
    FilesystemMiddleware,
    BashMiddleware,
    SubAgentMiddleware,
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
} from './src/middleware';
import MemoryMiddleware from './src/middleware/memory';
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
    /** If true, standard middleware (Tasks, Skills, Filesystem) will not be loaded */
    skipDefaultMiddleware?: boolean;
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
     * @param config Optional configuration to customize model, prompt, and middleware.
     */
    constructor(config: DeepAgentConfig = {}) {
        const baseInstructions = `You are a capable AI assistant that plans and executes work systematically.

You have access to task management, modular skills, memory systems, the REAL project filesystem, and sub-agents.

## Core Workflow for Complex Requests

1. **PLAN**: Use \`generate_tasks\` to break down the work into specific, actionable tasks
2. **GET NEXT**: Use \`get_next_tasks\` to see what's available
3. **START TASK**: Mark a task \`in_progress\` with \`update_task\`
4. **EXECUTE**: Read files, understand code, make changes
5. **COMPLETE**: Mark task \`completed\` with \`update_task\`
6. **REPEAT**: Move to the next task

## Task Rules

- Tasks MUST be SPECIFIC with actual file paths
- DO NOT create generic tasks like "analyze requirements" or "implement logic"
- Example GOOD tasks: "Read src/auth.ts to understand login flow", "Add password validation to src/auth.ts"
- Example BAD tasks: "Analyze requirements", "Implement feature", "Write tests"

## Other Tools

- \`activate_skill(name)\` - Activate specialized skills (frontend, gsap-animations, etc.)
- \`list_skills()\` - See available skills
- Sub-agents save results to \`subagent_results/\` - read them with \`readFile()\`
- \`bash()\` - Shell operations (grep, find, etc.)
- \`readFile()\` / \`writeFile()\` - File management

## Important

- ALWAYS use tasks for complex multi-step work
- Follow the tasks you create - mark them in_progress, then completed
- Read back your changes to verify they're correct`;

        const backend = config.backend || new SqliteBackend(
            config.dbPath || 'workspace/vibes.db',
            config.sessionId || 'default'
        );

        super({
            model: config.model || openai('gpt-4o'),
            instructions: baseInstructions,
            ...config,
        }, backend);

        // Initialize built-in middleware
        this.initializeMiddleware(config);
    }

    private initializeMiddleware(config: DeepAgentConfig): void {
        const skipDefaults = config.skipDefaultMiddleware === true;
        const workspaceDir = config.workspaceDir || 'workspace';

        if (!skipDefaults) {
            this.addMiddleware([
                // PlanningMiddleware extends TasksMiddleware with deep agent features:
                // - Task recitation (always-in-view current plan)
                // - Plan save/load from filesystem
                // - Hierarchical task support
                new PlanningMiddleware(this.model, {
                    planPath: `${workspaceDir}/plan.md`,
                    maxRecitationTasks: 10,
                }),
                // ReasoningMiddleware provides multiple reasoning patterns:
                // - ReAct: Think-act loop (default)
                // - ToT: Tree-of-Thoughts for parallel exploration
                // - Plan-Execute: Separate planning and execution phases
                new ReasoningMiddleware(this.model, {
                    initialMode: 'tot',
                    maxBranches: 5,
                    autoExplore: true,
                    complexityThreshold: 5,
                }),
                // ReflexionMiddleware adds self-improvement capabilities:
                // - Automatic error analysis and lesson extraction
                // - Structured lesson storage with metadata
                // - Contextual lesson retrieval and suggestion
                new ReflexionMiddleware(this.model, {
                    maxLessons: 100,
                    lessonsPath: `${workspaceDir}/lessons.json`,
                    autoAnalyzeErrors: true,
                    analysisThreshold: 2,
                    autoSuggestLessons: true,
                }),
                // SemanticMemoryMiddleware provides vector-based fact storage:
                // - Store facts with optional embeddings for semantic search
                // - Retrieve relevant facts by meaning (RAG-style memory)
                // - Keyword-based fallback when embeddings unavailable
                // - Persistent storage to workspace/facts.json
                new SemanticMemoryMiddleware(this.model, {
                    maxFacts: 200,
                    factsPath: `${workspaceDir}/facts.json`,
                    similarityThreshold: 0.3,
                    autoExtract: true,
                }),
                // ProceduralMemoryMiddleware stores reusable patterns and workflows:
                // - Store successful approaches as reusable patterns
                // - Retrieve relevant patterns by context
                // - Track pattern success rates over time
                // - Persistent storage to workspace/patterns.json
                new ProceduralMemoryMiddleware(this.model, {
                    maxPatterns: 50,
                    patternsPath: `${workspaceDir}/patterns.json`,
                    autoSuggest: true,
                }),
                // SwarmMiddleware enables decentralized multi-agent collaboration:
                // - Shared state between agents
                // - Signaling between agents
                // - Task proposal and claiming for swarm coordination
                // - Persistent swarm state
                new SwarmMiddleware(
                    config.swarmId || config.sessionId || 'default',
                    {
                        maxStateEntries: 100,
                        maxSignalHistory: 50,
                        statePath: `${workspaceDir}/swarm-state.json`,
                        persistState: true,
                    }
                ),
                new SkillsMiddleware(),
                new FilesystemMiddleware({ baseDir: workspaceDir }),
                new BashMiddleware(workspaceDir),
                new MemoryMiddleware()
            ])
        }

        // SubAgent middleware
        const subAgentMap = new Map<string, SubAgent>();

        if (config.subAgents) {
            config.subAgents.forEach(agent => {
                subAgentMap.set(agent.name, agent);
            });
        }

        this.addMiddleware(new SubAgentMiddleware(
            subAgentMap,
            this.model,
            () => this.getAllTools(),
            () => this.middleware,
            workspaceDir
        ))

        // Custom middleware
        if (config.middleware) {
            this.addMiddleware([...config.middleware]);
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
    PlanningMiddleware,
    ReasoningMiddleware,
    ReflexionMiddleware,
    SemanticMemoryMiddleware,
    ProceduralMemoryMiddleware,
    SwarmMiddleware,
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