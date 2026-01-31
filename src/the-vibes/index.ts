/// <reference types="bun-types" />

import { openai } from '@ai-sdk/openai';
import {
    SkillsMiddleware,
    TasksMiddleware,
    FilesystemMiddleware,
    BashMiddleware,
    SubAgentMiddleware,
} from './middleware';
import MemoryMiddleware from './middleware/memory';
import SqliteBackend from './backend/sqlitebackend';
import {
    AgentState,
    AgentDataParts,
    AgentUIMessage,
    VibeAgentConfig,
    SubAgent,
    TaskItem,
    TaskTemplate,
} from './core/types';
import { VibeAgent } from './core/agent';

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
                new TasksMiddleware(this.backend, this.model),
                new SkillsMiddleware(),
                new FilesystemMiddleware(workspaceDir, this.backend),
                new BashMiddleware(workspaceDir),
                new MemoryMiddleware(this.backend)
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
    TasksMiddleware,
    createDeepAgent,
};