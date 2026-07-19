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
import * as fs from 'fs';
import { stat, mkdir, rm } from 'fs/promises';
import { VibesAgent } from '../agent/agent';
import type { VibesAgentConfig, AgentState } from '../types';
import type { Sandbox } from '../sandbox';
import { LocalSandbox } from '../../sandbox/local-sandbox';
import type StateBackend from '../../storage/state-backend';
import type { SessionInfo, WorkspaceInfo } from '../../storage/state-backend';
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
     * `{projectsDir}/{workspaceId}/.vibes/sessions/{sessionId}/` — kept out of
     * an opened external repo.
     */
    stateDir: string;
    /** Cross-session shared-state dir (memories.json, workflows.json). Global. */
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
    workspaceId?: string;
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
        await this.ensureDefaultWorkspace();

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

        // Resolve the session's directories. Order matters so a RELOAD honours
        // what was persisted at creation (a workspace session's shared project
        // dir), since the caller (e.g. the HTTP layer) usually reloads knowing
        // only the session id, not its workspace:
        //   1. persisted metadata.workspaceDir  → reuse (legacy or workspace)
        //   2. config.workspaceId / stored workspace_id → shared project dir
        //   3. fallback → legacy per-session dir
        // A session with no explicit workspace joins the Default workspace
        // (the old backend got this for free from an eager insert that defaulted
        // workspace_id to 'default'; we now make it explicit).
        const workspaceId = config.workspaceId ?? existingSession?.workspaceId ?? 'default';
        // Cross-session shared state (memories.json / workflows.json) is global,
        // one level up from the projects dir — NEVER inside an opened repo.
        const sharedDir = path.dirname(this.projectsDir);
        let workspaceDir: string;   // sandbox root (file/shell work)
        let stateDir: string;       // per-session plugin state
        if (typeof existingMeta.workspaceDir === 'string') {
            workspaceDir = existingMeta.workspaceDir;
            stateDir = typeof existingMeta.stateDir === 'string' ? existingMeta.stateDir : workspaceDir;
        } else if (workspaceId) {
            const ws = await backend.getWorkspace(workspaceId);
            workspaceDir = ws?.rootDir ?? path.join(this.projectsDir, workspaceId);
            // Per-session plugin state lives in an APP-MANAGED dir keyed by the
            // workspace + session — not under workspaceDir. For an app-managed
            // workspace this still resolves to `{rootDir}/.vibes/...`; for an
            // OPENED external folder it stays out of the user's repo.
            stateDir = path.join(this.projectsDir, workspaceId, '.vibes', 'sessions', sessionId);
        } else {
            workspaceDir = path.join(this.sessionsDir, sessionId);
            stateDir = workspaceDir;
        }

        await this.ensureDirectory(workspaceDir);
        if (stateDir !== workspaceDir) await this.ensureDirectory(stateDir);

        const alreadyTitled = Boolean(existingMeta.title);
        const dirsPersisted = typeof existingMeta.workspaceDir === 'string';
        if (config.title !== undefined || config.metadata !== undefined || !alreadyTitled || !dirsPersisted) {
            await backend.updateSession(sessionId, {
                title: config.title,
                ...(workspaceId ? { workspaceId } : {}),
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
        // state (plan/tasks/scratchpad) uses stateDir; global memories/workflows
        // use sharedDir.
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
    async listSessions(workspaceId?: string): Promise<SessionInfo[]> {
        const backend = await this.makeBackend('default');
        return backend.listSessions(workspaceId);
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

    // ── Workspace (project) lifecycle ────────────────────────────────────

    /**
     * Ensure a Default workspace exists and points at this store's configured
     * `projectsDir`. `connectStore` creates the schema but seeds no rows, so we
     * create the Default workspace on first use; if the store is rooted
     * elsewhere (tests, alternative deployments) we repoint it here. No-op once
     * the workspace already matches.
     */
    private async ensureDefaultWorkspace(): Promise<void> {
        if (this.defaultWorkspaceEnsured) return;
        this.defaultWorkspaceEnsured = true;
        const desiredRoot = path.join(this.projectsDir, 'default');
        const backend = await this.makeBackend('default');
        const ws = await backend.getWorkspace('default');
        if (!ws) {
            await backend.createWorkspace({ id: 'default', name: 'Default', rootDir: desiredRoot });
        } else if (ws.rootDir !== desiredRoot) {
            await backend.setWorkspaceRootDir('default', desiredRoot);
        }
    }

    /** List all workspaces (with session counts). */
    async listWorkspaces(): Promise<WorkspaceInfo[]> {
        await this.ensureDefaultWorkspace();
        const backend = await this.makeBackend('default');
        return backend.listWorkspaces();
    }

    /** Get one workspace, or null. */
    async getWorkspace(workspaceId: string): Promise<WorkspaceInfo | null> {
        const backend = await this.makeBackend('default');
        return backend.getWorkspace(workspaceId);
    }

    /**
     * Create a workspace. Two flavours:
     *  - **app-managed** (default): allocate an id + a fresh project directory
     *    under `projectsDir` and create it on disk.
     *  - **open folder** (`rootDir` given): point the workspace at an EXISTING
     *    directory on disk (Codex / Claude-cowork style). The directory must
     *    already exist; per-session `.vibes` state stays app-managed so the
     *    opened repo isn't polluted.
     */
    async createWorkspace(config: { id?: string; name?: string; rootDir?: string; metadata?: Record<string, any> }): Promise<WorkspaceInfo> {
        const id = config.id || this.generateWorkspaceId();
        const metadata: Record<string, any> = { ...(config.metadata ?? {}) };
        let rootDir: string;
        let name = config.name?.trim();

        if (config.rootDir) {
            rootDir = path.resolve(config.rootDir);
            let isDir = false;
            try { isDir = (await stat(rootDir)).isDirectory(); } catch { isDir = false; }
            if (!isDir) throw new Error(`Not a directory: ${rootDir}`);
            metadata.external = true;
            if (!name) name = path.basename(rootDir) || rootDir;
        } else {
            rootDir = path.join(this.projectsDir, id);
            await this.ensureDirectory(rootDir);
            if (!name) name = 'Untitled workspace';
        }

        const backend = await this.makeBackend('default');
        return backend.createWorkspace({ id, name, rootDir, metadata });
    }

    /** Rename / update a workspace's metadata. */
    async updateWorkspace(workspaceId: string, updates: { name?: string; metadata?: Record<string, any> }): Promise<void> {
        const backend = await this.makeBackend('default');
        await backend.updateWorkspace(workspaceId, updates);
    }

    /**
     * Delete a workspace, its sessions (DB rows + cached agents), and its
     * on-disk project directory.
     */
    async deleteWorkspace(workspaceId: string): Promise<void> {
        const backend = await this.makeBackend('default');
        const sessions = await backend.listSessions(workspaceId);
        for (const s of sessions) this.unloadSession(s.id);
        await backend.deleteWorkspace(workspaceId);

        // Remove only the APP-MANAGED directory (per-session `.vibes` state, and
        // for an app-managed workspace its project files too). We deliberately
        // never delete an opened external folder — that is the user's own repo,
        // which always lives outside `projectsDir/{workspaceId}`.
        await this.deleteDirectory(path.join(this.projectsDir, workspaceId));
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
