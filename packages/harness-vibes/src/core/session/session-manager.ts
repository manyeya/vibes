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
 *   └── memories.json    - Long-term memory notes
 */

import * as path from 'path';
import { stat } from 'fs/promises';
import { AgentCore } from '../agent/agent-core';
import type { AgentCoreConfig, AgentState } from '../types';
import type { Sandbox } from '../sandbox';
import { LocalSandbox } from '../../sandbox/local-sandbox';
import SqliteBackend from '../../backend/sqlite-backend';
import type { SessionInfo, WorkspaceInfo } from '../../backend/sqlite-backend';
import type { UIMessageStreamWriter } from 'ai';
import type { VibesUIMessage } from '../streaming/streaming';

/**
 * Per-session context handed to a {@link SessionAgentFactory}. The factory
 * (typically supplied by `Harness`) builds the actual agent for the
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
export type SessionAgentFactory = (ctx: SessionContext) => AgentCore;

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
export interface SessionAgentConfig extends Partial<AgentCoreConfig> {
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
    agent: AgentCore;
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
export class SessionStore {
    private sessions: Map<string, StoredSession> = new Map();
    private dbPath: string;
    private sessionsDir: string;
    private projectsDir: string;

    /** Default agent configuration (used only when no agentFactory is set) */
    private defaultAgentConfig?: SessionAgentConfig;
    /** Builds the agent for each session. When unset, a bare AgentCore is used. */
    private agentFactory?: SessionAgentFactory;
    /** Guard so the Default-workspace reconciliation runs at most once. */
    private defaultWorkspaceEnsured = false;

    constructor(config?: {
        /** Path to SQLite database (default: workspace/vibes.db) */
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
        this.dbPath = config?.dbPath || path.join(WORKSPACE_ROOT, 'vibes.db');
        this.sessionsDir = config?.sessionsDir || SESSIONS_DIR;
        this.projectsDir = config?.projectsDir || PROJECTS_DIR;
        this.defaultAgentConfig = config?.defaultAgentConfig;
        this.agentFactory = config?.agentFactory;

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

        // Create SQLite backend for this session. NOTE: the SqliteBackend
        // constructor eagerly inserts a bare session row, so a "create only if
        // missing" guard never fires — which silently dropped the caller's
        // title. Persist title/metadata via updateSession instead so the
        // user-provided title is actually saved.
        const backend = new SqliteBackend(this.dbPath, sessionId);
        const existingSession = await backend.getSession(sessionId);
        const existingMeta = existingSession?.metadata ?? {};

        // Resolve the session's directories. Order matters so a RELOAD honours
        // what was persisted at creation (a workspace session's shared project
        // dir), since the caller (e.g. the HTTP layer) usually reloads knowing
        // only the session id, not its workspace:
        //   1. persisted metadata.workspaceDir  → reuse (legacy or workspace)
        //   2. config.workspaceId / stored workspace_id → shared project dir
        //   3. fallback → legacy per-session dir
        const workspaceId = config.workspaceId ?? existingSession?.workspaceId;
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
        // stateDir. Without a factory we fall back to a bare AgentCore. The
        // sandbox backs the filesystem/artifact tools (node fs on the real
        // workspace dir); the shell runs through just-bash in BashPlugin, rooted
        // at the same directory, so the two views stay in sync.
        const sandbox = new LocalSandbox(workspaceDir);
        const agent = this.agentFactory
            ? this.agentFactory({ sessionId, workspaceDir, stateDir, sharedDir, sandbox })
            : new AgentCore(this.buildAgentConfig(sessionId, workspaceDir, stateDir, sharedDir));

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
    ): AgentCoreConfig {
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
        } as AgentCoreConfig;
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
    async listSessions(workspaceId?: string): Promise<SessionInfo[]> {
        const backend = new SqliteBackend(this.dbPath, 'default');
        const sessions = await backend.listSessions(workspaceId);
        backend.close();
        return sessions;
    }

    /**
     * Read a session's persisted state (messages, summary, metadata) without
     * loading the session or building its agent. Cheap, read-only — intended
     * for HTTP endpoints that just render history.
     */
    readState(sessionId: string): AgentState {
        const backend = new SqliteBackend(this.dbPath, sessionId);
        const state = backend.getState();
        backend.close();
        return state;
    }

    /**
     * Read the persisted UI messages (parts include data-* activity) for a
     * session, or null if none were stored. Cheap, read-only.
     */
    readUIMessages(sessionId: string): unknown[] | null {
        const backend = new SqliteBackend(this.dbPath, sessionId);
        const ui = backend.getUIMessages();
        backend.close();
        return ui;
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

    // ── Workspace (project) lifecycle ────────────────────────────────────

    /**
     * Reconcile the migration-backfilled Default workspace with this store's
     * configured `projectsDir`. The SqliteBackend migration can only hardcode a
     * conventional `workspace/projects/default`; if the store is rooted
     * elsewhere (tests, alternative deployments) we repoint it here. No-op in
     * the common case where the paths already match.
     */
    private async ensureDefaultWorkspace(): Promise<void> {
        if (this.defaultWorkspaceEnsured) return;
        this.defaultWorkspaceEnsured = true;
        const desiredRoot = path.join(this.projectsDir, 'default');
        const backend = new SqliteBackend(this.dbPath, 'default');
        try {
            const ws = await backend.getWorkspace('default');
            if (!ws) {
                await backend.createWorkspace({ id: 'default', name: 'Default', rootDir: desiredRoot });
            } else if (ws.rootDir !== desiredRoot) {
                backend.setWorkspaceRootDir('default', desiredRoot);
            }
        } finally {
            backend.close();
        }
    }

    /** List all workspaces (with session counts). */
    async listWorkspaces(): Promise<WorkspaceInfo[]> {
        await this.ensureDefaultWorkspace();
        const backend = new SqliteBackend(this.dbPath, 'default');
        const workspaces = await backend.listWorkspaces();
        backend.close();
        return workspaces;
    }

    /** Get one workspace, or null. */
    async getWorkspace(workspaceId: string): Promise<WorkspaceInfo | null> {
        const backend = new SqliteBackend(this.dbPath, 'default');
        const ws = await backend.getWorkspace(workspaceId);
        backend.close();
        return ws;
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

        const backend = new SqliteBackend(this.dbPath, 'default');
        const ws = await backend.createWorkspace({ id, name, rootDir, metadata });
        backend.close();
        return ws;
    }

    /** Rename / update a workspace's metadata. */
    async updateWorkspace(workspaceId: string, updates: { name?: string; metadata?: Record<string, any> }): Promise<void> {
        const backend = new SqliteBackend(this.dbPath, 'default');
        await backend.updateWorkspace(workspaceId, updates);
        backend.close();
    }

    /**
     * Delete a workspace, its sessions (DB rows + cached agents), and its
     * on-disk project directory.
     */
    async deleteWorkspace(workspaceId: string): Promise<void> {
        const backend = new SqliteBackend(this.dbPath, 'default');
        const sessions = await backend.listSessions(workspaceId);
        for (const s of sessions) this.unloadSession(s.id);
        await backend.deleteWorkspace(workspaceId);
        backend.close();

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
    getSessionWorkspace(sessionId: string): string {
        try {
            const backend = new SqliteBackend(this.dbPath, sessionId);
            const meta = backend.getState().metadata as { workspaceDir?: unknown } | undefined;
            backend.close();
            if (meta && typeof meta.workspaceDir === 'string') return meta.workspaceDir;
        } catch { /* fall through to the computed default */ }
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
     * Generate a unique workspace ID
     */
    private generateWorkspaceId(): string {
        return `wp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
export const defaultSessionManager = new SessionStore();
