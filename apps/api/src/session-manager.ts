/**
 * API Session Manager - Manages sessions with per-session isolated workspaces.
 *
 * This file provides the session management layer for the API server.
 * Each session gets:
 * - Isolated workspace: workspace/sessions/{sessionId}/
 * - DeepAgent instance with specialized sub-agents
 * - SQLite metadata storage via harness-vibes
 */

import { SessionManager as HarnessSessionManager } from '../../../packages/harness-vibes/index';
import { DeepAgent } from '../../../packages/harness-vibes/index';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { wrapLanguageModel } from 'ai';
import { devToolsMiddleware } from '@ai-sdk/devtools';
import { mimoCodePrompt } from './prompts/mimo-code';
import { createZhipu } from 'zhipu-ai-provider';
import { dotenvLoad } from 'dotenv-mono';
import { webSearch } from "@exalabs/ai-sdk";

// Load env vars from root .env
dotenvLoad();

// Model setup
const zhipu = createZhipu({
    baseURL: 'https://api.z.ai/api/paas/v4',
    apiKey: process.env.ZHIPU_API_KEY,
});

const model = wrapLanguageModel({
    model: zhipu('glm-4.7-flash') as any,
    middleware: devToolsMiddleware(),
});

// Sub-agents configuration
const defaultSubAgents = [
    {
        name: 'Planner',
        description: 'Specialized in high-level task breakdown, recursive execution, and progress tracking.',
        systemPrompt: `You are Planner, the strategic logical core of the team.
        Your role is to break complex requests into exhaustive, actionable todo lists.`,
        mode: 'general-purpose' as const,
        allowedTools: ['create_plan', 'generate_tasks', 'update_task', 'get_next_tasks', 'list_tasks', 'readFile','writeFile'],
        allowSubdelegation: false,
        artifactMode: 'always' as const,
    },
    {
        name: 'Librarian',
        description: 'Focused on codebase documentation, design patterns, and systemic context.',
        systemPrompt: `You are Librarian. Your role is to maintain the "Source of Truth" for the project.`,
        mode: 'general-purpose' as const,
        allowedTools: ['readFile', 'list_files'],
        allowSubdelegation: false,
        artifactMode: 'always' as const,
    },
    {
        name: 'Explorer',
        description: 'Specialized in navigating large codebases and finding relevant files/logic.',
        systemPrompt: `You are Explorer. Your role is to map out the codebase and find exactly what is needed.`,
        mode: 'general-purpose' as const,
        allowedTools: ['readFile', 'list_files', 'bash'],
        allowSubdelegation: false,
        artifactMode: 'always' as const,
    },
    {
        name: 'Oracle',
        description: 'RAG-based knowledge retrieval and expert Q&A for the codebase.',
        systemPrompt: `You are Oracle. Your role is to answer complex questions about the system logic and architecture.`,
        mode: 'general-purpose' as const,
        allowedTools: ['readFile', 'list_files', 'webSearch'],
        allowSubdelegation: false,
        artifactMode: 'always' as const,
    },
    {
        name: 'SuperCoder',
        description: 'Elite Front End UI/UX Engineer and Creative Technologist.',
        systemPrompt: `You are SuperCoder, the master of implementation. Focus on stunning visuals, fluid interactions, and flawless performance.`,
        mode: 'general-purpose' as const,
        allowedTools: ['readFile', 'writeFile', 'list_files', 'bash', 'activate_skill'],
        allowSubdelegation: false,
        artifactMode: 'always' as const,
    },
    {
        name: 'BrowserAgent',
        description: 'Browser Automation with agent-browser for research and testing.',
        systemPrompt: `You are BrowserAgent. Your role is to interact with the web and verify the UI.`,
        mode: 'general-purpose' as const,
        allowedTools: ['bash', 'activate_skill', 'readFile', 'writeFile'],
        allowSubdelegation: false,
        artifactMode: 'always' as const,
    }
];

/**
 * In-memory agent instance with metadata
 */
interface AgentInstance {
    agent: DeepAgent;
    lastAccessed: number;
}

/**
 * APISessionManager manages sessions with isolated workspaces.
 *
 * Uses HarnessSessionManager for:
 * - Session metadata storage (SQLite)
 * - Workspace directory management
 * - Session listing/deletion
 *
 * Maintains its own cache of DeepAgent instances in memory.
 */
class APISessionManager {
    private sessions: Map<string, AgentInstance> = new Map();
    private harnessManager: HarnessSessionManager;

    constructor() {
        this.harnessManager = new HarnessSessionManager({
            dbPath: 'workspace/vibes.db',
            sessionsDir: 'workspace/sessions',
        });

        // Start periodic cleanup (every 30 minutes)
        setInterval(() => {
            this.cleanup();
        }, 30 * 60 * 1000);
    }

    /**
     * Get or create an agent instance for the given session ID.
     * This is the primary entry point for the API.
     */
    getOrCreateAgent(sessionId: string = 'default'): DeepAgent {
        let instance = this.sessions.get(sessionId);

        if (!instance) {
            // Get the workspace directory for this session
            const workspaceDir = this.harnessManager.getSessionWorkspace(sessionId);

            // Ensure workspace directory exists (sync version)
            const proc = Bun.spawnSync(['mkdir', '-p', workspaceDir]);

            // Create new DeepAgent instance for this session with its own workspace
            const agent = new DeepAgent({
                model,
                systemPrompt: mimoCodePrompt,
                maxSteps: 60,
                maxContextMessages: 3,
                sessionId,
                workspaceDir,
                tools: {
                    webSearch: webSearch() as any,
                },
                subAgents: defaultSubAgents,
            });

            instance = {
                agent,
                lastAccessed: Date.now(),
            };

            this.sessions.set(sessionId, instance);

            // Create session record in database (metadata only)
            this.harnessManager.ensureSession({ id: sessionId }).catch((err: Error) => {
                console.error(`Failed to create session record for ${sessionId}:`, err);
            });
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
     * Delete a session completely (memory + disk)
     */
    async deleteSession(sessionId: string): Promise<void> {
        // Unload from memory
        this.unloadSession(sessionId);
        // Delete workspace and metadata via harness manager
        await this.harnessManager.deleteSession(sessionId);
    }

    /**
     * List all sessions from the database
     */
    async listSessions(): Promise<Array<{
        id: string;
        summary?: string;
        metadata?: Record<string, any>;
        createdAt?: string;
        updatedAt?: string;
        messageCount?: number;
    }>> {
        return await this.harnessManager.listSessions();
    }

    /**
     * Get session info from database (doesn't load into memory)
     */
    async getSessionInfo(sessionId: string): Promise<{
        id: string;
        summary?: string;
        metadata?: Record<string, any>;
        createdAt?: string;
        updatedAt?: string;
        messageCount?: number;
    } | null> {
        return await this.harnessManager.getSessionInfo(sessionId);
    }

    /**
     * Create a new session
     */
    async createSession(title?: string, metadata: Record<string, any> = {}): Promise<string> {
        // Create session record in database
        const session = await this.harnessManager.ensureSession({
            title,
            metadata,
        });
        return session.id;
    }

    /**
     * Update session metadata
     */
    async updateSession(sessionId: string, updates: {
        title?: string;
        summary?: string;
        metadata?: Record<string, any>;
    }): Promise<void> {
        await this.harnessManager.updateSession(sessionId, updates);
    }

    /**
     * Get all currently loaded session IDs
     */
    getLoadedSessions(): string[] {
        return Array.from(this.sessions.keys());
    }

    /**
     * Clean up sessions that haven't been accessed in a while
     */
    private cleanup(): void {
        const maxAge = 1000 * 60 * 30; // 30 minutes
        const now = Date.now();
        const toDelete: string[] = [];

        for (const [sessionId, instance] of this.sessions) {
            if (now - instance.lastAccessed > maxAge) {
                toDelete.push(sessionId);
            }
        }

        for (const sessionId of toDelete) {
            this.unloadSession(sessionId);
        }

        if (toDelete.length > 0) {
            console.log(`[APISessionManager] Unloaded ${toDelete.length} idle sessions`);
        }
    }

    /**
     * Get the workspace directory for a session
     */
    getSessionWorkspace(sessionId: string): string {
        return this.harnessManager.getSessionWorkspace(sessionId);
    }
}

// Global session manager instance
export const sessionManager = new APISessionManager();
export default sessionManager;
