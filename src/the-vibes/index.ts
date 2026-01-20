/// <reference types="bun-types" />

import { openai } from '@ai-sdk/openai';
import {
    SkillsMiddleware,
    TodoListMiddleware,
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
    /** If true, standard middleware (Todos, Skills, Filesystem) will not be loaded */
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
 * It supports multi-step reasoning, persistent state (todos/findings),
 * real filesystem access, modular skills, and sub-agent delegation.
 */
export class DeepAgent extends VibeAgent {
    /**
     * Initializes a new DeepAgent instance.
     * @param config Optional configuration to customize model, prompt, and middleware.
     */
    constructor(config: DeepAgentConfig = {}) {
        const baseInstructions = `You are a capable AI assistant that can tackle complex, multi-step tasks.

You have access to planning tools (todos), modular skills, memory systems, the REAL project filesystem, and the ability to spawn specialized sub-agents.

## Core Principles
1. PLAN before acting: Use todos to break down complex tasks and track progress.
2. LOAD SKILLS: Use modular skills for specialized expertise. Search and load them when tackling domains you're unfamiliar with.
3. USE MEMORY: Use your scratchpad to maintain your current cognitive state and reflections for long-term learning.
4. LAZY LOAD: Use the filesystem to offload large context. Sub-agents save their work to files rather than returning full text to keep your context window clean.
5. DELEGATE: Use sub-agents for specialized expertise or to isolate focused research threads.
6. ITERATE: Always verify results. Read files to review sub-agent outputs or your own previous work.

## Best Practices
- For complex tasks, ALWAYS create a todo list first.
- Keep your scratchpad updated with \`update_scratchpad()\` to track your current thinking and status.
- Search for available skills using \`list_skills()\` and load relevant ones with \`load_skill()\`.
- Move large data, code blocks, or research reports to files in the project root or relevant subdirectories.
- Sub-agent results are saved to \`subagent_results/\`. If you need to see what a sub-agent did, use \`readFile()\` on the path it provides.
- Use \`bash()\` for advanced shell operations (grep, find, etc.).
- Use \`list_files()\` to understand the project structure when navigating new areas.
- Use \`readFile()\` and \`writeFile()\` for direct file management.

Think step by step and tackle tasks systematically.`;

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
            this.middleware.push(new TodoListMiddleware(this.backend));
            this.middleware.push(new SkillsMiddleware());
            this.middleware.push(new FilesystemMiddleware(workspaceDir));
            this.middleware.push(new BashMiddleware(workspaceDir));
            this.middleware.push(new MemoryMiddleware(this.backend));
        }

        // SubAgent middleware
        const subAgentMap = new Map<string, SubAgent>();
        if (config.subAgents) {
            config.subAgents.forEach(agent => {
                subAgentMap.set(agent.name, agent);
            });
        }

        this.middleware.push(new SubAgentMiddleware(
            subAgentMap,
            this.model,
            () => this.getAllTools(),
            () => this.middleware,
            workspaceDir
        ));

        // Custom middleware
        if (config.middleware) {
            this.middleware.push(...config.middleware);
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
    createDeepAgent,
};