/**
 * AgentRuntime Session Manager - Comprehensive session management with per-session workspaces.
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
 *   └── memories.json    - Long-term memory notes
 */

import * as path from 'path';
import { createHash } from 'crypto';
import * as fs from 'fs';
import { stat, mkdir, rm } from 'fs/promises';
import { VibesAgent } from '../agent/agent';
import type { VibesAgentConfig, AgentState } from '../types';
import type { Sandbox } from '../sandbox';
import { LocalSandbox } from '../../sandbox/local-sandbox';
import type StateBackend from '../../storage/state-backend';
import type { SessionInfo } from '../../storage/state-backend';
import { connectStore, type StoreConnection } from '../../storage/connect';
import type { UIMessageStreamWriter } from 'ai';
import type { VibesUIMessage } from '../streaming/streaming';

/**
 * Per-session context handed to a {@link SessionAgentFactory}. The factory
 * (typically supplied by `AgentRuntime`) builds the actual agent for the
 * session, so the store stays decoupled from any specific agent flavour.
 */
export interface SessionContext {
    sessionId: string;
    /**
     * Sandbox root for this session — the directory the agent does file/shell
     * work in. For a workspace session this is the SHARED project dir; for a
     * legacy session it is the per-session dir.
     */
    workspaceDir: string;
    /**
     * Per-session plugin-state dir (plan.md, tasks.json, scratchpad.md,
     * tracked_files.json). Equals {@link workspaceDir} for legacy sessions; for
     * a workspace session it is an app-managed
     * `{projectsDir}/{escapedCwd}/sessions/{sessionId}/` — kept out of
     * an opened external repo.
     */
    stateDir: string;
    /** Cross-session shared-state dir (memories.json). Global. */
    sharedDir: string;
    /** A sandbox rooted at {@link workspaceDir}. */
    sandbox: Sandbox;
}

/** Builds the agent instance for a session from its {@link SessionContext}. */
export type SessionAgentFactory = (ctx: SessionContext) => VibesAgent;

/**
 * Root workspace directory
 */
const WORKSPACE_ROOT = 'workspace';
const SESSIONS_DIR = path.join(WORKSPACE_ROOT, 'sessions');
const PROJECTS_DIR = path.join(WORKSPACE_ROOT, 'projects');

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
    /** Workspace (project) this session belongs to. Sessions in a workspace
     *  share the workspace's project dir as their sandbox root. */
    /**
     * The directory this session works in. A session IS a conversation rooted
     * at a directory — there is no separate workspace object (see `cwd` in the
     * runtime). Defaults to the process cwd.
     */
    cwd?: string;
}

/**
 * Agent creation configuration for a session
 */
export interface SessionAgentConfig extends Partial<VibesAgentConfig> {
    /** Workspace directory (will be set to session workspace) */
    workspaceDir?: string;
}

/**
 * Session instance with all associated resources
 */
export interface StoredSession {
    /** Unique session identifier */
    id: string;
    /** The agent instance for this session */
    agent: VibesAgent;
    /** Persistent storage backend for this session */
    backend: StateBackend;
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
 * AgentRuntime Session Manager
 *
 * Manages complete session lifecycle with per-session isolated workspaces.
 * Session working state is isolated while long-term memory stays shared.
 */
/**
 * Directory → a filesystem-safe key for per-session state, mirroring how Claude
 * Code names its project folders: non-alphanumerics become '-', and an
 * over-long path is truncated with a hash appended so two long paths cannot
 * collide. This is our own rule; the upstream algorithm is not published.
 */
export function escapeDirKey(dir: string): string {
    const resolved = path.resolve(dir);
    const flat = resolved.replace(/[^a-zA-Z0-9]/g, '-');
    if (flat.length <= 200) return flat;
    return `${flat.slice(0, 200)}-${createHash('sha256').update(resolved).digest('hex').slice(0, 12)}`;
}

export class SessionStore {
    private sessions: Map<string, StoredSession> = new Map();
    private databaseUrl?: string;
    private dbPath: string;
    private sessionsDir: string;
    private projectsDir: string;
    /** Lazily-built shared storage connection (one pool per store). */
    private connPromise?: Promise<StoreConnection>;

    /** Default agent configuration (used only when no agentFactory is set) */
    private defaultAgentConfig?: SessionAgentConfig;
    /** Builds the agent for each session. When unset, a bare AgentHarness is used. */
    private agentFactory?: SessionAgentFactory;
    /** Guard so the Default-workspace reconciliation runs at most once. */
    private defaultWorkspaceEnsured = false;

    constructor(config?: {
        /** Postgres connection string. When set, persists to Postgres instead of SQLite. */
        databaseUrl?: string;
        /** Path to the SQLite file (used when no `databaseUrl` is given; default: workspace/vibes.db) */
        dbPath?: string;
        /** Directory for legacy per-session workspaces (default: workspace/sessions) */
        sessionsDir?: string;
        /** Root directory for workspace (project) dirs (default: workspace/projects) */
        projectsDir?: string;
        /** Default agent configuration (fallback when no agentFactory is provided) */
        defaultAgentConfig?: SessionAgentConfig;
        /** Factory that builds the per-session agent (e.g. the flagship VibeAgent). */
        agentFactory?: SessionAgentFactory;
    }) {
        this.databaseUrl = config?.databaseUrl;
        this.dbPath = config?.dbPath || path.join(WORKSPACE_ROOT, 'vibes.db');
        this.sessionsDir = config?.sessionsDir || SESSIONS_DIR;
        this.projectsDir = config?.projectsDir || PROJECTS_DIR;
        this.defaultAgentConfig = config?.defaultAgentConfig;
        this.agentFactory = config?.agentFactory;

        // Ensure sessions directory exists
        this.ensureSessionsDirectory();
    }

    /**
     * The shared storage connection — built once, reused for the store's life.
     * Postgres when `databaseUrl` is set, otherwise a local SQLite file.
     */
    private store(): Promise<StoreConnection> {
        if (!this.connPromise) {
            this.connPromise = connectStore({ databaseUrl: this.databaseUrl, dbPath: this.dbPath });
        }
        return this.connPromise;
    }

    /** A per-session backend view over the shared connection. Cheap. */
    private async makeBackend(sessionId: string): Promise<StateBackend> {
        return (await this.store()).makeBackend(sessionId);
    }

    /** Public accessor for a per-session backend over the shared connection. */
    openBackend(sessionId: string): Promise<StateBackend> {
        return this.makeBackend(sessionId);
    }

    /**
     * Get or create a session with its agent and isolated workspace.
     *
     * This is the primary entry point for session-based interactions.
     * Each session gets its own workspace directory where all plugin
     * data is stored.
     */
    async getOrCreateSession(config: SessionConfig = {}): Promise<StoredSession> {
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
    getSession(sessionId: string): StoredSession | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * Create a new session with isolated workspace
     */
    private async createSession(
        sessionId: string,
        config: SessionConfig
    ): Promise<StoredSession> {
        const createdAt = new Date();

        // Persist title/metadata via updateSession (which upserts the session
        // row) so a freshly-created session's user-provided title is saved.
        const backend = await this.makeBackend(sessionId);
        const existingSession = await backend.getSession(sessionId);
        const existingMeta = existingSession?.metadata ?? {};

        // A session is rooted at a directory, full stop. What was persisted at
        // creation wins on reload (the caller usually knows only the session
        // id); otherwise the caller's cwd; otherwise the process cwd.
        const sharedDir = this.projectsDir;
        const workspaceDir = typeof existingMeta.workspaceDir === 'string'
            ? existingMeta.workspaceDir
            : path.resolve(config.cwd ?? process.cwd());
        // Per-session plugin state is keyed by the directory but stored under
        // our own root, so we never write into the user's project.
        const stateDir = typeof existingMeta.stateDir === 'string'
            ? existingMeta.stateDir
            : path.join(this.projectsDir, escapeDirKey(workspaceDir), 'sessions', sessionId);

        await this.ensureDirectory(workspaceDir);
        if (stateDir !== workspaceDir) await this.ensureDirectory(stateDir);

        const alreadyTitled = Boolean(existingMeta.title);
        const dirsPersisted = typeof existingMeta.workspaceDir === 'string';
        if (config.title !== undefined || config.metadata !== undefined || !alreadyTitled || !dirsPersisted) {
            await backend.updateSession(sessionId, {
                title: config.title,
                metadata: {
                    ...existingMeta,
                    ...config.metadata,
                    workspaceDir,
                    stateDir,
                    createdAt: existingMeta.createdAt ?? createdAt.toISOString(),
                },
            });
        }

        // Build the agent. The factory (when provided) constructs the real
        // agent — typically the flagship VibeAgent — rooted at a sandbox for the
        // (possibly shared) workspace dir, with per-session plugin state kept in
        // stateDir. Without a factory we fall back to a bare AgentHarness. The
        // sandbox backs both the filesystem/artifact tools (node fs on the real
        // workspace dir) and the shell (BashPlugin runs commands through the
        // sandbox's `exec`, a real host shell via Bun.$, rooted here).
        const sandbox = new LocalSandbox(workspaceDir);
        const agent = this.agentFactory
            ? this.agentFactory({ sessionId, workspaceDir, stateDir, sharedDir, sandbox })
            : new VibesAgent(this.buildAgentConfig(sessionId, workspaceDir, stateDir, sharedDir));

        const instance: StoredSession = {
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
        workspaceDir: string,
        stateDir: string = workspaceDir,
        sharedDir?: string
    ): VibesAgentConfig {
        const baseConfig = this.defaultAgentConfig || {};

        // Sandbox-rooted file/shell work uses workspaceDir; per-session plugin
        // state (plan/tasks/scratchpad) uses stateDir; global memories use
        // sharedDir.
        return {
            ...baseConfig,
            workspaceDir,
            stateDir,
            ...(sharedDir ? { sharedDir } : {}),
            // Session ID is passed through metadata for plugins to use
            sessionId,
        } as VibesAgentConfig;
    }

    /**
     * Unload a session from memory (closes backend, keeps data on disk)
     */
    unloadSession(sessionId: string): boolean {
        const instance = this.sessions.get(sessionId);
        if (instance) {
            // The connection is shared and owned by the store, so there is no
            // per-session handle to close here — just drop the cached instance.
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
        const backend = await this.makeBackend('default');
        await backend.deleteSession(sessionId);

        // Delete session workspace directory
        const workspaceDir = path.join(this.sessionsDir, sessionId);
        await this.deleteDirectory(workspaceDir);
    }

    /**
     * List all sessions (including unloaded ones)
     */
    /** Sessions for a directory (all sessions when omitted). */
    async listSessions(cwd?: string): Promise<SessionInfo[]> {
        const backend = await this.makeBackend('default');
        return backend.listSessions(cwd ? path.resolve(cwd) : undefined);
    }

    /**
     * Read a session's persisted state (messages, summary, metadata) without
     * loading the session or building its agent. Cheap, read-only — intended
     * for HTTP endpoints that just render history.
     */
    async readState(sessionId: string): Promise<AgentState> {
        const backend = await this.makeBackend(sessionId);
        return backend.getState();
    }

    /**
     * Read the persisted UI messages (parts include data-* activity) for a
     * session, or null if none were stored. Cheap, read-only.
     */
    async readUIMessages(sessionId: string): Promise<unknown[] | null> {
        const backend = await this.makeBackend(sessionId);
        return backend.getUIMessages();
    }

    /**
     * Get session info without loading into memory
     */
    async getSessionInfo(sessionId: string): Promise<SessionInfo | null> {
        const backend = await this.makeBackend(sessionId);
        return backend.getSession(sessionId);
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
        const backend = await this.makeBackend('default');
        await backend.updateSession(sessionId, updates);

        // Update in-memory instance if loaded
        const instance = this.sessions.get(sessionId);
        if (instance) {
            if (updates.title) instance.title = updates.title;
            if (updates.metadata) {
                instance.metadata = { ...instance.metadata, ...updates.metadata };
            }
        }
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
    getLoadedSessions(): StoredSession[] {
        return Array.from(this.sessions.values());
    }

    /**
     * Get session IDs for currently loaded sessions
     */
    getLoadedSessionIds(): string[] {
        return Array.from(this.sessions.keys());
    }

    /**
     * Get the sandbox-root directory for a session. Honours the dir persisted
     * at creation (so workspace sessions resolve to their shared project dir),
     * falling back to the legacy per-session path.
     */
    async getSessionWorkspace(sessionId: string): Promise<string> {
        try {
            const backend = await this.makeBackend(sessionId);
            const meta = (await backend.getState()).metadata as { workspaceDir?: unknown } | undefined;
            if (meta && typeof meta.workspaceDir === 'string') return meta.workspaceDir;
        } catch { /* fall through to the computed default */ }
        return path.join(this.sessionsDir, sessionId);
    }

    /**
     * Generate a unique session ID
     */
    private generateSessionId(): string {
        return `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }

    /**
     * Generate a unique workspace ID
     */
    private generateWorkspaceId(): string {
        return `wp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }

    /**
     * Ensure the sessions directory exists
     */
    private ensureSessionsDirectory(): void {
        fs.mkdirSync(this.sessionsDir, { recursive: true });
    }

    /**
     * Ensure a directory exists
     */
    private async ensureDirectory(dirPath: string): Promise<void> {
        await mkdir(dirPath, { recursive: true });
    }

    /**
     * Delete a directory recursively
     */
    private async deleteDirectory(dirPath: string): Promise<void> {
        await rm(dirPath, { recursive: true, force: true });
    }

    /**
     * Persist session metadata to database
     */
    private async persistSessionMetadata(sessionId: string): Promise<void> {
        const instance = this.sessions.get(sessionId);
        if (!instance) return;

        const backend = await this.makeBackend('default');
        await backend.updateSession(sessionId, {
            title: instance.title,
            metadata: instance.metadata,
        });
    }
}

/**
 * Default session manager instance
 */
export const defaultSessionManager = new SessionStore();
