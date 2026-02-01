import { DeepAgent } from 'harness-vibes';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { wrapLanguageModel } from 'ai';
import { devToolsMiddleware } from '@ai-sdk/devtools';
import { mimoCodePrompt } from './prompts/mimo-code';
import { zhipu } from 'zhipu-ai-provider';
import { dotenvLoad } from 'dotenv-mono';

// Load env vars from root .env (automatically walks up directories)
dotenvLoad();


const model = wrapLanguageModel({
    model: zhipu('glm-4.7-flash') as any,
    middleware: devToolsMiddleware(),
});

interface AgentInstance {
    agent: DeepAgent;
    lastAccessed: number;
}

/**
 * SessionManager manages multiple agent instances, one per session.
 * Each session has its own isolated state and conversation history.
 */
class SessionManager {
    private sessions: Map<string, AgentInstance> = new Map();
    private dbPath: string;

    constructor(dbPath: string = 'workspace/vibes.db') {
        this.dbPath = dbPath;
    }

    /**
     * Get or create an agent instance for the given session ID
     */
    getOrCreateAgent(sessionId: string = 'default'): DeepAgent {
        let instance = this.sessions.get(sessionId);

        if (!instance) {
            // Create new agent instance for this session
            const agent = new DeepAgent({
                maxContextMessages: 30,
                model: model,
                systemPrompt: mimoCodePrompt,
                maxSteps: 60,
                sessionId: sessionId,
                dbPath: this.dbPath,
                subAgents: [
                    {
                        name: 'Planner',
                        description: 'Specialized in high-level task breakdown, recursive execution, and progress tracking (Planner-Sisyphus equivalent).',
                        systemPrompt: `You are Planner, the strategic logical core of the team.
                        Your role is to break complex requests into exhaustive, actionable todo lists.

                        Key areas:
                        - **Task Decomposition**: Split massive goals into small, verifiable chunks.
                        - **Execution Strategy**: Determine the optimal order of operations.
                        - **Progress Monitoring**: Regularly update the todo list as sub-agents complete their work.`,
                        allowedTools: ["writeFile", "readFile"]
                    },
                    {
                        name: 'Librarian',
                        description: 'Focused on codebase documentation, design patterns, and systemic context.',
                        systemPrompt: `You are Librarian. Your role is to maintain the "Source of Truth" for the project.

                        Key areas:
                        - **Documentation**: Write and maintain READMEs, design docs, and API specs.
                        - **Pattern Discovery**: Identify re-usable patterns and components in the codebase.
                        - **Context Management**: Ensure all agents have the necessary background information.`,
                        allowedTools: ["writeFile", "readFile"]
                    },
                    {
                        name: 'Explorer',
                        description: 'Specialized in navigating large codebases and finding relevant files/logic.',
                        systemPrompt: `You are Explorer. Your role is to map out the codebase and find exactly what is needed.

                        Key areas:
                        - **Code Search**: Use grep, find, and file listings to locate specific logic.
                        - **Dependency Mapping**: Understand how different parts of the system interact.
                        - **Entry Point Identification**: Find where to start making changes.`,
                        allowedTools: ["writeFile", "readFile", "bash"]
                    },
                    {
                        name: 'Oracle',
                        description: 'RAG-based knowledge retrieval and expert Q&A for the codebase.',
                        systemPrompt: `You are Oracle. Your role is to answer complex questions about the system logic and architecture.

                        Key areas:
                        - **Logic Explanation**: Explain *why* certain code is written the way it is.
                        - **Constraint Analysis**: Identify potential side-effects or breaking changes.
                        - **Architectural Guidance**: Provide advice on how to integrate new features.`,
                        allowedTools: ["writeFile", "readFile"]
                    },
                    {
                        name: 'SuperCoder',
                        description: 'Elite Front End UI/UX Engineer and Creative Technologist.',
                        systemPrompt: `You are SuperCoder, the master of implementation.
                        Focus on stunning visuals, fluid interactions, and flawless performance.

                        Use the awwwards skills to ensure your work is visually stunning and engaging.
                        Key areas:
                        - **Visual Design**: High-end aesthetics and layout.
                        - **Implementation**: Writing clean, robust, and performant code.
                        - **Component Architecture**: Scalable design systems.`,
                        allowedTools: ["writeFile", "readFile", "bash","activate_skill"],
                    },
                    {
                        name: 'BrowserAgent',
                        description: 'Browser Automation with agent-browser for research and testing.',
                        systemPrompt: `You are BrowserAgent. Your role is to interact with the web and verify the UI.

                        Key areas:
                        - **Research**: Find design inspiration or technical solutions on the web.
                        - **UI Testing**: Automate browser actions to verify functionality and accessibility.
                        - **Visual Auditing**: Check for visual regressions and layout issues.`,
                        allowedTools: ["writeFile", "readFile", "bash"]
                    }
                ]
            });

            instance = {
                agent,
                lastAccessed: Date.now()
            };

            this.sessions.set(sessionId, instance);
        } else {
            // Update last accessed time
            instance.lastAccessed = Date.now();
        }

        return instance.agent;
    }

    /**
     * Remove a session from memory (doesn't delete data, just unloads)
     */
    unloadSession(sessionId: string): boolean {
        return this.sessions.delete(sessionId);
    }

    /**
     * Get all currently loaded sessions
     */
    getLoadedSessions(): string[] {
        return Array.from(this.sessions.keys());
    }

    /**
     * Clean up sessions that haven't been accessed in a while
     */
    cleanup(maxAge: number = 1000 * 60 * 30): void { // 30 minutes default
        const now = Date.now();
        const toDelete: string[] = [];

        for (const [sessionId, instance] of this.sessions) {
            if (now - instance.lastAccessed > maxAge) {
                toDelete.push(sessionId);
            }
        }

        for (const sessionId of toDelete) {
            this.sessions.delete(sessionId);
        }
    }
}

// Global session manager instance
export const sessionManager = new SessionManager();
export default sessionManager;
