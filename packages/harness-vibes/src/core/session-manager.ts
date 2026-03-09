/**
 * Harness Session Manager - Comprehensive session management with per-session workspaces.
 *
 * Features:
 * - Each session gets an isolated workspace directory (workspace/sessions/{sessionId}/)
 * - Session working state is stored per-session, while long-term memory remains shared
 * - Agent instances are cached in memory with configurable TTL
 * - Session lifecycle management (create, get, delete, cleanup)
 * - Integration with SQLite backend for persistent session metadata
 *
 * Directory structure per session:
 * workspace/sessions/{sessionId}/
 *   ├── scratchpad.md    - Session working memory
 *   ├── plan.md          - Planning state
 *   ├── tasks.json       - Task queue
 *   ├── tracked_files.json - Filesystem plugin session state
 *   └── subagent_results/ - Sub-agent outputs
 *
 * Cross-session shared files remain in workspace/:
 *   ├── lessons.json     - Reflexion lessons
 *   ├── facts.json       - Semantic memory
 *   ├── patterns.json    - Procedural memory
 *   ├── swarm-state.json - Swarm coordination
 *   └── reflections.md   - Appended reflections
 */

import * as path from 'path';
import { VibeAgent } from './agent';
import type { VibeAgentConfig } from './types';
import SqliteBackend from '../backend/sqlitebackend';
import type { SessionInfo } from '../backend/sqlitebackend';
import type { UIMessageStreamWriter } from 'ai';
import type { VibesUIMessage } from './streaming';

/**
 * Root workspace directory
 */
const WORKSPACE_ROOT = 'workspace';
const SESSIONS_DIR = path.join(WORKSPACE_ROOT, 'sessions');

/**
 * Session configuration
 */
export interface SessionConfig {
    /** Unique session identifier (auto-generated if not provided) */
    id?: string;
    /** Session title/summary */
    title?: string;
    /** Additional metadata */
    metadata?: Record<string, any>;
    /** Base directory for all session workspaces (default: workspace/sessions) */
    sessionsDir?: string;
}

/**
 * Agent creation configuration for a session
 */
export interface SessionAgentConfig extends Partial<VibeAgentConfig> {
    /** Workspace directory (will be set to session workspace) */
    workspaceDir?: string;
}

/**
 * Session instance with all associated resources
 */
export interface SessionInstance {
    /** Unique session identifier */
    id: string;
    /** The agent instance for this session */
    agent: VibeAgent;
    /** Persistent storage backend for this session */
    backend: SqliteBackend;
    /** Session workspace directory (absolute path) */
    workspaceDir: string;
    /** Last access timestamp for cleanup */
    lastAccessed: number;
    /** Current UI writer for streaming updates */
    writer?: UIMessageStreamWriter<VibesUIMessage>;
    /** Session metadata */
    metadata: Record<string, any>;
    /** Session title/summary */
    title?: string;
    /** When the session was created */
    createdAt: Date;
}

/**
 * Options for session cleanup
 */
export interface CleanupOptions {
    /** Maximum age in milliseconds before unloading (default: 30 minutes) */
    maxAge?: number;
    /** Whether to also delete session data from disk */
    deleteData?: boolean;
}

/**
 * Harness Session Manager
 *
 * Manages complete session lifecycle with per-session isolated workspaces.
 * Session working state is isolated while long-term memory stays shared.
 */
export class HarnessSessionManager {
    private sessions: Map<string, SessionInstance> = new Map();
    private dbPath: string;
    private sessionsDir: string;

    /** Default agent configuration factory */
    private defaultAgentConfig?: SessionAgentConfig;

    constructor(config?: {
        /** Path to SQLite database (default: workspace/vibes.db) */
        dbPath?: string;
        /** Directory for session workspaces (default: workspace/sessions) */
        sessionsDir?: string;
        /** Default agent configuration */
        defaultAgentConfig?: SessionAgentConfig;
    }) {
        this.dbPath = config?.dbPath || path.join(WORKSPACE_ROOT, 'vibes.db');
        this.sessionsDir = config?.sessionsDir || SESSIONS_DIR;
        this.defaultAgentConfig = config?.defaultAgentConfig;

        // Ensure sessions directory exists
        this.ensureSessionsDirectory();
    }

    /**
     * Get or create a session with its agent and isolated workspace.
     *
     * This is the primary entry point for session-based interactions.
     * Each session gets its own workspace directory where all plugin
     * data is stored.
     */
    async getOrCreateSession(config: SessionConfig = {}): Promise<SessionInstance> {
        // Use provided ID or generate a new one
        const sessionId = config.id || this.generateSessionId();

        // Check if session is already loaded in memory
        let instance = this.sessions.get(sessionId);

        if (!instance) {
            // Create new session instance
            instance = await this.createSession(sessionId, config);
            this.sessions.set(sessionId, instance);
        } else {
            // Update last accessed time
            instance.lastAccessed = Date.now();

            // Update metadata if provided
            if (config.metadata) {
                instance.metadata = { ...instance.metadata, ...config.metadata };
                await this.persistSessionMetadata(sessionId);
            }
            if (config.title) {
                instance.title = config.title;
                await this.persistSessionMetadata(sessionId);
            }
        }

        return instance;
    }

    /**
     * Get an existing session without creating a new one
     */
    getSession(sessionId: string): SessionInstance | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * Create a new session with isolated workspace
     */
    private async createSession(
        sessionId: string,
        config: SessionConfig
    ): Promise<SessionInstance> {
        const createdAt = new Date();

        // Create session workspace directory
        const workspaceDir = path.join(this.sessionsDir, sessionId);
        await this.ensureDirectory(workspaceDir);

        // Create SQLite backend for this session
        const backend = new SqliteBackend(this.dbPath, sessionId);

        // Create session record in database
        const existingSession = await backend.getSession(sessionId);
        if (!existingSession) {
            await backend.createSession(config.title, {
                ...config.metadata,
                workspaceDir,
                createdAt: createdAt.toISOString(),
            });
        }

        // Build agent configuration with session workspace
        const agentConfig = this.buildAgentConfig(sessionId, workspaceDir);

        // Create agent instance
        const agent = new VibeAgent(agentConfig);

        const instance: SessionInstance = {
            id: sessionId,
            agent,
            backend,
            workspaceDir,
            lastAccessed: Date.now(),
            metadata: config.metadata || {},
            title: config.title,
            createdAt,
        };

        return instance;
    }

    /**
     * Build agent configuration with session-specific paths
     */
    private buildAgentConfig(
        sessionId: string,
        workspaceDir: string
    ): VibeAgentConfig {
        const baseConfig = this.defaultAgentConfig || {};

        // All plugin paths should point to the session workspace
        return {
            ...baseConfig,
            workspaceDir,
            // Session ID is passed through metadata for plugins to use
            sessionId,
        } as VibeAgentConfig;
    }

    /**
     * Unload a session from memory (closes backend, keeps data on disk)
     */
    unloadSession(sessionId: string): boolean {
        const instance = this.sessions.get(sessionId);
        if (instance) {
            instance.backend.close();
            return this.sessions.delete(sessionId);
        }
        return false;
    }

    /**
     * Delete a session completely (memory + disk)
     */
    async deleteSession(sessionId: string): Promise<void> {
        // Unload from memory
        this.unloadSession(sessionId);

        // Delete from database
        const backend = new SqliteBackend(this.dbPath, 'default');
        await backend.deleteSession(sessionId);
        backend.close();

        // Delete session workspace directory
        const workspaceDir = path.join(this.sessionsDir, sessionId);
        await this.deleteDirectory(workspaceDir);
    }

    /**
     * List all sessions (including unloaded ones)
     */
    async listSessions(): Promise<SessionInfo[]> {
        const backend = new SqliteBackend(this.dbPath, 'default');
        const sessions = await backend.listSessions();
        backend.close();
        return sessions;
    }

    /**
     * Get session info without loading into memory
     */
    async getSessionInfo(sessionId: string): Promise<SessionInfo | null> {
        const backend = new SqliteBackend(this.dbPath, sessionId);
        const info = await backend.getSession(sessionId);
        backend.close();
        return info;
    }

    /**
     * Update session metadata
     */
    async updateSession(
        sessionId: string,
        updates: {
            title?: string;
            summary?: string;
            metadata?: Record<string, any>;
        }
    ): Promise<void> {
        const backend = new SqliteBackend(this.dbPath, 'default');
        await backend.updateSession(sessionId, updates);

        // Update in-memory instance if loaded
        const instance = this.sessions.get(sessionId);
        if (instance) {
            if (updates.title) instance.title = updates.title;
            if (updates.metadata) {
                instance.metadata = { ...instance.metadata, ...updates.metadata };
            }
        }

        backend.close();
    }

    /**
     * Clean up old sessions
     */
    cleanup(options: CleanupOptions = {}): {
        unloaded: string[];
        deleted: string[];
    } {
        const maxAge = options.maxAge || 1000 * 60 * 30; // 30 minutes default
        const now = Date.now();
        const unloaded: string[] = [];
        const deleted: string[] = [];

        for (const [sessionId, instance] of this.sessions) {
            if (now - instance.lastAccessed > maxAge) {
                if (options.deleteData) {
                    this.deleteSession(sessionId);
                    deleted.push(sessionId);
                } else {
                    this.unloadSession(sessionId);
                    unloaded.push(sessionId);
                }
            }
        }

        return { unloaded, deleted };
    }

    /**
     * Get all currently loaded sessions
     */
    getLoadedSessions(): SessionInstance[] {
        return Array.from(this.sessions.values());
    }

    /**
     * Get session IDs for currently loaded sessions
     */
    getLoadedSessionIds(): string[] {
        return Array.from(this.sessions.keys());
    }

    /**
     * Get the workspace directory for a session
     */
    getSessionWorkspace(sessionId: string): string {
        return path.join(this.sessionsDir, sessionId);
    }

    /**
     * Check if a session workspace exists
     */
    sessionWorkspaceExists(sessionId: string): boolean {
        const workspaceDir = this.getSessionWorkspace(sessionId);
        // Simple check using Bun filesystem
        try {
            return Bun.file(workspaceDir).size >= 0; // Directory check
        } catch {
            return false;
        }
    }

    /**
     * Export session data to a zip file (for backup/transfer)
     */
    async exportSession(sessionId: string): Promise<Blob> {
        const workspaceDir = this.getSessionWorkspace(sessionId);

        // Create a tar.gz of the session directory
        const proc = Bun.spawn(['tar', '-czf', '-', '-C', this.sessionsDir, sessionId], {
            stdout: 'pipe',
        });

        const blob = await new Response(proc.stdout).blob();
        await proc.exited;

        return blob;
    }

    /**
     * Import session data from a zip file
     */
    async importSession(archiveData: ArrayBuffer, newSessionId?: string): Promise<string> {
        const sessionId = newSessionId || this.generateSessionId();
        const workspaceDir = this.getSessionWorkspace(sessionId);

        await this.ensureDirectory(workspaceDir);

        // Extract the archive
        const proc = Bun.spawn([
            'tar',
            '-xzf',
            '-',
            '-C',
            this.sessionsDir,
            '--strip-components=0',
        ], {
            stdin: new Blob([archiveData]),
        });

        await proc.exited;

        // Rename extracted directory to new session ID if needed
        return sessionId;
    }

    /**
     * Generate a unique session ID
     */
    private generateSessionId(): string {
        return `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }

    /**
     * Ensure the sessions directory exists
     */
    private ensureSessionsDirectory(): void {
        const proc = Bun.spawnSync(['mkdir', '-p', this.sessionsDir]);
        if (proc.exitCode !== 0) {
            throw new Error(`Failed to create sessions directory: ${this.sessionsDir}`);
        }
    }

    /**
     * Ensure a directory exists
     */
    private async ensureDirectory(dirPath: string): Promise<void> {
        const proc = Bun.spawn(['mkdir', '-p', dirPath]);
        await proc.exited;
    }

    /**
     * Delete a directory recursively
     */
    private async deleteDirectory(dirPath: string): Promise<void> {
        const proc = Bun.spawn(['rm', '-rf', dirPath]);
        await proc.exited;
    }

    /**
     * Persist session metadata to database
     */
    private async persistSessionMetadata(sessionId: string): Promise<void> {
        const instance = this.sessions.get(sessionId);
        if (!instance) return;

        const backend = new SqliteBackend(this.dbPath, 'default');
        await backend.updateSession(sessionId, {
            title: instance.title,
            metadata: instance.metadata,
        });
        backend.close();
    }
}

/**
 * Default session manager instance
 */
export const defaultSessionManager = new HarnessSessionManager();
