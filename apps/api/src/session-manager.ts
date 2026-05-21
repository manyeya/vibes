/**
 * API session registry. Manages the in-memory cache of DeepAgent instances
 * keyed by session id, plus per-session AbortControllers for the active
 * stream. Session metadata + workspace lifecycle is delegated entirely to
 * the harness `SessionManager`.
 *
 * Agent construction (model selection, sub-agents, prompts) lives in
 * `./agent-factory.ts`. Model resolution lives in `./model-factory.ts`.
 */

import { SessionManager as HarnessSessionManager } from '../../../packages/harness-vibes/index';
import { DeepAgent } from '../../../packages/harness-vibes/index';
import { dotenvLoad } from 'dotenv-mono';
import { createAgentForSession } from './agent-factory';
import type { ModelSpec } from './model-factory';

// Load env vars from root .env
dotenvLoad();

/**
 * In-memory agent instance with metadata
 */
interface AgentInstance {
    agent: DeepAgent;
    lastAccessed: number;
}

/**
 * Per-session abort controller registry entry.
 * Holds the controller for the session's currently-active stream.
 */
interface StreamControllerEntry {
    controller: AbortController;
    startedAt: number;
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
    private streamControllers: Map<string, StreamControllerEntry> = new Map();
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
     *
     * @param sessionId Stable session identifier.
     * @param modelSpec Optional per-session model override. If omitted,
     *                  the model factory falls back to env-driven defaults
     *                  (AI Gateway when available, else Zhipu / OpenAI / etc).
     */
    getOrCreateAgent(sessionId: string = 'default', modelSpec?: ModelSpec): DeepAgent {
        let instance = this.sessions.get(sessionId);

        if (!instance) {
            const workspaceDir = this.harnessManager.getSessionWorkspace(sessionId);
            Bun.spawnSync(['mkdir', '-p', workspaceDir]);

            const agent = createAgentForSession({
                sessionId,
                workspaceDir,
                modelSpec,
            });

            instance = {
                agent,
                lastAccessed: Date.now(),
            };

            this.sessions.set(sessionId, instance);

            // Create session record in database (metadata only)
            this.harnessManager.getOrCreateSession({ id: sessionId }).catch((err: Error) => {
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
        const session = await this.harnessManager.getOrCreateSession({
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
     * Register an AbortController for a session's active stream. If the
     * session already has a registered controller, abort the previous one
     * (newest-wins) so a stray stream does not get orphaned.
     */
    registerStreamController(sessionId: string, controller: AbortController): void {
        const existing = this.streamControllers.get(sessionId);
        if (existing && existing.controller !== controller) {
            existing.controller.abort(new Error('superseded by new stream'));
        }
        this.streamControllers.set(sessionId, { controller, startedAt: Date.now() });
    }

    /**
     * Clear a session's stream controller if it matches the supplied one.
     * A mismatch means a newer stream already took the slot — leave it alone.
     */
    clearStreamController(sessionId: string, controller: AbortController): void {
        const existing = this.streamControllers.get(sessionId);
        if (existing && existing.controller === controller) {
            this.streamControllers.delete(sessionId);
        }
    }

    /**
     * Abort the session's currently-active stream, if any.
     * Returns true if a stream was aborted, false if nothing was running.
     */
    abortStream(sessionId: string, reason?: string): boolean {
        const existing = this.streamControllers.get(sessionId);
        if (!existing) return false;
        existing.controller.abort(new Error(reason ?? 'client requested abort'));
        this.streamControllers.delete(sessionId);
        return true;
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
