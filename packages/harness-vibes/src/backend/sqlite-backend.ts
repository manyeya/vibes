import { Database } from "bun:sqlite";
import { AgentState, TodoItem, TaskItem, TaskTemplate } from "../core/types";
import * as path from "path";
import StateBackend from "./state-backend";

/**
 * Result from execution order calculation
 */
/**
 * Session metadata for listing sessions
 */
export interface SessionInfo {
    id: string;
    summary?: string;
    metadata?: Record<string, any>;
    createdAt?: string;
    updatedAt?: string;
    messageCount?: number;
    /** The workspace (project) this session belongs to, if any. */
    workspaceId?: string;
}

/**
 * Workspace (project) metadata. A workspace groups multiple sessions that
 * share one project directory (`rootDir`). See the session manager for how
 * the shared sandbox + per-session `.vibes/sessions/{id}/` state dirs hang
 * off `rootDir`.
 */
export interface WorkspaceInfo {
    id: string;
    name: string;
    /** Absolute or workspace-relative project directory shared by the sessions. */
    rootDir: string;
    metadata?: Record<string, any>;
    createdAt?: string;
    updatedAt?: string;
    /** Number of sessions in this workspace (populated by listWorkspaces). */
    sessionCount?: number;
}

/**
 * Persistent state manager for the agent using Bun SQLite.
 * Handles conversation history, structured todo list data, and session metadata.
 */
export default class SqliteBackend extends StateBackend {
    private db: Database;
    private sessionId: string;

    constructor(dbPath: string = 'workspace/vibes.db', sessionId: string = 'default') {
        super();
        this.sessionId = sessionId;

        // Ensure directory exists sync-ish (constructor limitation)
        const dir = path.dirname(dbPath);
        const { exitCode } = Bun.spawnSync(["mkdir", "-p", dir]);

        this.db = new Database(dbPath);
        this.init();
    }

    /** Current schema version. Bump and add a new migration block below. */
    private static readonly SCHEMA_VERSION = 3;

    /** The default workspace every pre-existing session is grouped under. */
    private static readonly DEFAULT_WORKSPACE_ID = 'default';

    private init() {
        const versionRow = this.db.query("PRAGMA user_version").get() as { user_version?: number } | undefined;
        let currentVersion = versionRow?.user_version ?? 0;

        if (currentVersion < 1) {
            // Migration 1: sessions + messages + content_type column + index.
            // Idempotent: pre-versioned databases may already have the tables.
            this.db.transaction(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS sessions (
                        id TEXT PRIMARY KEY,
                        summary TEXT,
                        metadata TEXT,
                        created_at TEXT,
                        updated_at TEXT
                    )
                `);
                // Legacy ALTER TABLE migrations for databases that predate
                // created_at/updated_at. ADD COLUMN throws on duplicate; ignore.
                const now = new Date().toISOString();
                try { this.db.run(`ALTER TABLE sessions ADD COLUMN created_at TEXT`); } catch { /* exists */ }
                try { this.db.run(`ALTER TABLE sessions ADD COLUMN updated_at TEXT`); } catch { /* exists */ }
                this.db.run(`UPDATE sessions SET created_at = ? WHERE created_at IS NULL`, [now]);
                this.db.run(`UPDATE sessions SET updated_at = ? WHERE updated_at IS NULL`, [now]);

                this.db.run(`
                    CREATE TABLE IF NOT EXISTS messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id TEXT,
                        role TEXT,
                        content TEXT,
                        content_type TEXT,
                        FOREIGN KEY(session_id) REFERENCES sessions(id)
                    )
                `);
                // Legacy migration: messages predates content_type.
                try { this.db.run(`ALTER TABLE messages ADD COLUMN content_type TEXT`); } catch { /* exists */ }

                this.db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id, id)`);
            })();
            this.db.run(`PRAGMA user_version = 1`);
            currentVersion = 1;
        }

        if (currentVersion < 2) {
            // Migration 2: streams + stream_log tables for resumable streams.
            this.db.transaction(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS streams (
                        stream_id TEXT PRIMARY KEY,
                        session_id TEXT,
                        started_at TEXT,
                        ended_at TEXT,
                        status TEXT
                    )
                `);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_streams_session_id ON streams(session_id, started_at)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_streams_ended_at ON streams(ended_at)`);

                this.db.run(`
                    CREATE TABLE IF NOT EXISTS stream_log (
                        stream_id TEXT,
                        chunk_seq INTEGER,
                        payload TEXT,
                        created_at TEXT,
                        PRIMARY KEY (stream_id, chunk_seq)
                    )
                `);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_stream_log_created_at ON stream_log(created_at)`);
            })();
            this.db.run(`PRAGMA user_version = 2`);
            currentVersion = 2;
        }

        if (currentVersion < 3) {
            // Migration 3: workspaces (projects) that group sessions sharing a
            // project directory. Adds a workspaces table + a nullable
            // workspace_id on sessions, and backfills a Default workspace that
            // every pre-existing session is grouped under.
            this.db.transaction(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS workspaces (
                        id TEXT PRIMARY KEY,
                        name TEXT,
                        root_dir TEXT,
                        metadata TEXT,
                        created_at TEXT,
                        updated_at TEXT
                    )
                `);
                // Idempotent column add (mirrors the ui_messages pattern).
                try { this.db.run(`ALTER TABLE sessions ADD COLUMN workspace_id TEXT`); } catch { /* exists */ }
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_workspace_id ON sessions(workspace_id, updated_at)`);

                // Backfill the Default workspace + assign orphaned sessions to it.
                const now = new Date().toISOString();
                const defaultId = SqliteBackend.DEFAULT_WORKSPACE_ID;
                this.db.run(
                    `INSERT OR IGNORE INTO workspaces (id, name, root_dir, metadata, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [defaultId, 'Default', `workspace/projects/${defaultId}`, JSON.stringify({}), now, now]
                );
                this.db.run(`UPDATE sessions SET workspace_id = ? WHERE workspace_id IS NULL`, [defaultId]);
            })();
            this.db.run(`PRAGMA user_version = 3`);
            currentVersion = 3;
        }

        void SqliteBackend.SCHEMA_VERSION;

        // Forward-compatible column for persisted UI messages (message parts
        // including data-* activity). Added unconditionally + idempotently so
        // existing databases gain the column without a version bump.
        try { this.db.run(`ALTER TABLE sessions ADD COLUMN ui_messages TEXT`); } catch { /* column exists */ }

        // Ensure session exists. New rows default to the Default workspace;
        // SessionStore overrides workspace_id for sessions created inside a
        // specific workspace (via updateSession).
        const session = this.db.query("SELECT id FROM sessions WHERE id = ?").get(this.sessionId);
        if (!session) {
            const now = new Date().toISOString();
            this.db.run("INSERT INTO sessions (id, metadata, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                [this.sessionId, JSON.stringify({}), SqliteBackend.DEFAULT_WORKSPACE_ID, now, now]);
        }
    }

    /**
     * Decode stored content. Rows written by the current schema carry a
     * content_type column; legacy rows fall back to a safe heuristic that
     * tolerates user text starting with `[` or `{`.
     */
    private decodeContent(content: string, contentType: string | null | undefined): unknown {
        if (contentType === 'json') {
            try { return JSON.parse(content); } catch { return content; }
        }
        if (contentType === 'text') {
            return content;
        }
        // Legacy row (NULL content_type). Try JSON only when it parses cleanly.
        if (content.startsWith('[') || content.startsWith('{')) {
            try { return JSON.parse(content); } catch { return content; }
        }
        return content;
    }

    /** Retrieves the full current state object */
    getState(): AgentState {
        const session = this.db.query("SELECT summary, metadata FROM sessions WHERE id = ?").get(this.sessionId) as any;
        const messages = this.db
            .query("SELECT role, content, content_type FROM messages WHERE session_id = ? ORDER BY id ASC")
            .all(this.sessionId) as Array<{ role: string; content: string; content_type: string | null }>;

        return {
            messages: messages.map(m => ({
                role: m.role,
                content: this.decodeContent(m.content, m.content_type),
            })) as any,
            metadata: JSON.parse(session?.metadata || '{}'),
            summary: session?.summary || undefined,
        };
    }

    /** Partially updates the internal state */
    setState(state: Partial<AgentState>): void {
        const now = new Date().toISOString();
        this.db.transaction(() => {
            if (state.summary !== undefined) {
                this.db.run("UPDATE sessions SET summary = ?, updated_at = ? WHERE id = ?", [state.summary, now, this.sessionId]);
            }
            if (state.metadata !== undefined) {
                this.db.run("UPDATE sessions SET metadata = ?, updated_at = ? WHERE id = ?", [JSON.stringify(state.metadata), now, this.sessionId]);
            }
            // Always update updated_at when state changes
            if (state.summary === undefined && state.metadata === undefined) {
                this.db.run("UPDATE sessions SET updated_at = ? WHERE id = ?", [now, this.sessionId]);
            }
            if (state.messages !== undefined) {
                this.db.run("DELETE FROM messages WHERE session_id = ?", [this.sessionId]);
                const insertMsg = this.db.prepare(
                    "INSERT INTO messages (session_id, role, content, content_type) VALUES (?, ?, ?, ?)"
                );
                for (const msg of state.messages) {
                    const isString = typeof msg.content === 'string';
                    const content = isString ? (msg.content as string) : JSON.stringify(msg.content);
                    const contentType = isString ? 'text' : 'json';
                    insertMsg.run(this.sessionId, msg.role, content, contentType);
                }
            }
        })();
    }


    /**
     * Persist the full UI message list for this session. These carry every
     * rendered part — text, reasoning, tool, and data-* activity (ToT
     * thoughts, tool progress, delegation, …) — so a reload restores the
     * whole conversation, not just the assistant text. Stored separately
     * from the model `messages` table (which feeds the agent's context).
     */
    setUIMessages(messages: unknown[]): void {
        const now = new Date().toISOString();
        this.db.run(
            "UPDATE sessions SET ui_messages = ?, updated_at = ? WHERE id = ?",
            [JSON.stringify(messages), now, this.sessionId]
        );
    }

    /** Read persisted UI messages, or null when none have been stored. */
    getUIMessages(): unknown[] | null {
        const row = this.db
            .query("SELECT ui_messages FROM sessions WHERE id = ?")
            .get(this.sessionId) as { ui_messages?: string } | undefined;
        if (!row?.ui_messages) return null;
        try {
            const parsed = JSON.parse(row.ui_messages);
            return Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    /**
     * List all sessions with metadata, optionally scoped to one workspace.
     */
    async listSessions(workspaceId?: string): Promise<SessionInfo[]> {
        const where = workspaceId ? `WHERE s.workspace_id = ?` : ``;
        const params = workspaceId ? [workspaceId] : [];
        const sessions = this.db.query(`
            SELECT s.id, s.summary, s.metadata, s.workspace_id, s.created_at, s.updated_at,
                   COUNT(DISTINCT m.id) as message_count
            FROM sessions s
            LEFT JOIN messages m ON s.id = m.session_id
            ${where}
            GROUP BY s.id
            ORDER BY s.updated_at DESC
        `).all(...params) as any[];

        return sessions.map(row => ({
            id: row.id,
            summary: row.summary || undefined,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            workspaceId: row.workspace_id || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            messageCount: row.message_count || 0
        }));
    }

    /**
     * Get a specific session's metadata
     */
    async getSession(sessionId: string): Promise<SessionInfo | null> {
        const row = this.db.query(`
            SELECT s.id, s.summary, s.metadata, s.workspace_id, s.created_at, s.updated_at,
                   COUNT(DISTINCT m.id) as message_count
            FROM sessions s
            LEFT JOIN messages m ON s.id = m.session_id
            WHERE s.id = ?
            GROUP BY s.id
        `).get(sessionId) as any;

        if (!row) return null;

        return {
            id: row.id,
            summary: row.summary || undefined,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            workspaceId: row.workspace_id || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            messageCount: row.message_count || 0
        };
    }

    /**
     * Create a new session
     */
    async createSession(title?: string, metadata: Record<string, any> = {}, workspaceId?: string): Promise<string> {
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const now = new Date().toISOString();

        const finalMetadata = title
            ? { ...metadata, title }
            : metadata;

        this.db.run(
            "INSERT INTO sessions (id, summary, metadata, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            [sessionId, null, JSON.stringify(finalMetadata), workspaceId ?? SqliteBackend.DEFAULT_WORKSPACE_ID, now, now]
        );

        return sessionId;
    }

    /**
     * Delete a session and all its associated data
     */
    async deleteSession(sessionId: string): Promise<void> {
        this.db.transaction(() => {
            this.db.run("DELETE FROM messages WHERE session_id = ?", [sessionId]);
            this.db.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
        })();
    }

    /**
     * Update session metadata
     */
    async updateSession(sessionId: string, updates: { title?: string; summary?: string; metadata?: Record<string, any>; workspaceId?: string }): Promise<void> {
        const current = await this.getSession(sessionId);
        if (!current) return;

        const now = new Date().toISOString();
        // MERGE over the DB's current metadata, never replace. The stream layer
        // writes token `usage` (and `lastStreamAt`) straight to this column via
        // setState; a caller persisting title/metadata from an in-memory copy
        // that predates those keys would otherwise clobber them (usage → 0).
        const finalMetadata = { ...(current.metadata || {}), ...(updates.metadata || {}) };
        if (updates.title) {
            finalMetadata.title = updates.title;
        }

        this.db.run(
            `UPDATE sessions SET summary = ?, metadata = ?, workspace_id = ?, updated_at = ? WHERE id = ?`,
            [
                updates.summary !== undefined ? updates.summary : current.summary || null,
                JSON.stringify(finalMetadata),
                updates.workspaceId !== undefined ? updates.workspaceId : current.workspaceId ?? SqliteBackend.DEFAULT_WORKSPACE_ID,
                now,
                sessionId
            ]
        );
    }

    // ============ WORKSPACE (project) MANAGEMENT ============

    /** List all workspaces, newest first, with a live session count. */
    async listWorkspaces(): Promise<WorkspaceInfo[]> {
        const rows = this.db.query(`
            SELECT w.id, w.name, w.root_dir, w.metadata, w.created_at, w.updated_at,
                   COUNT(s.id) as session_count
            FROM workspaces w
            LEFT JOIN sessions s ON s.workspace_id = w.id
            GROUP BY w.id
            ORDER BY w.updated_at DESC
        `).all() as any[];
        return rows.map(this.mapWorkspaceRow);
    }

    /** Get a single workspace by id, or null. */
    async getWorkspace(workspaceId: string): Promise<WorkspaceInfo | null> {
        const row = this.db.query(`
            SELECT w.id, w.name, w.root_dir, w.metadata, w.created_at, w.updated_at,
                   COUNT(s.id) as session_count
            FROM workspaces w
            LEFT JOIN sessions s ON s.workspace_id = w.id
            WHERE w.id = ?
            GROUP BY w.id
        `).get(workspaceId) as any;
        return row ? this.mapWorkspaceRow(row) : null;
    }

    /**
     * Create a workspace. The caller supplies the id + rootDir so the session
     * manager can keep the on-disk project directory and the DB record in sync.
     */
    async createWorkspace(workspace: { id: string; name: string; rootDir: string; metadata?: Record<string, any> }): Promise<WorkspaceInfo> {
        const now = new Date().toISOString();
        this.db.run(
            `INSERT INTO workspaces (id, name, root_dir, metadata, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [workspace.id, workspace.name, workspace.rootDir, JSON.stringify(workspace.metadata ?? {}), now, now]
        );
        const created = await this.getWorkspace(workspace.id);
        if (!created) throw new Error(`Failed to create workspace ${workspace.id}`);
        return created;
    }

    /**
     * Point a workspace at a different project directory. Used by the session
     * manager to reconcile the migration-backfilled Default workspace with the
     * harness's configured `projectsDir`.
     */
    setWorkspaceRootDir(workspaceId: string, rootDir: string): void {
        const now = new Date().toISOString();
        this.db.run(`UPDATE workspaces SET root_dir = ?, updated_at = ? WHERE id = ?`, [rootDir, now, workspaceId]);
    }

    /** Update a workspace's name/metadata. */
    async updateWorkspace(workspaceId: string, updates: { name?: string; metadata?: Record<string, any> }): Promise<void> {
        const current = await this.getWorkspace(workspaceId);
        if (!current) return;
        const now = new Date().toISOString();
        this.db.run(
            `UPDATE workspaces SET name = ?, metadata = ?, updated_at = ? WHERE id = ?`,
            [
                updates.name !== undefined ? updates.name : current.name,
                JSON.stringify(updates.metadata ?? current.metadata ?? {}),
                now,
                workspaceId,
            ]
        );
    }

    /**
     * Delete a workspace and all of its sessions (messages + session rows).
     * The on-disk project directory is removed by the session manager.
     */
    async deleteWorkspace(workspaceId: string): Promise<void> {
        this.db.transaction(() => {
            const sessionRows = this.db.query("SELECT id FROM sessions WHERE workspace_id = ?").all(workspaceId) as Array<{ id: string }>;
            for (const { id } of sessionRows) {
                this.db.run("DELETE FROM messages WHERE session_id = ?", [id]);
            }
            this.db.run("DELETE FROM sessions WHERE workspace_id = ?", [workspaceId]);
            this.db.run("DELETE FROM workspaces WHERE id = ?", [workspaceId]);
        })();
    }

    private mapWorkspaceRow = (row: any): WorkspaceInfo => ({
        id: row.id,
        name: row.name,
        rootDir: row.root_dir,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        sessionCount: row.session_count ?? 0,
    });

    // ============ STREAM PERSISTENCE (resumable streams) ============

    /**
     * Record the start of a stream. Idempotent: a duplicate streamId is a
     * no-op so re-entering on retry does not corrupt the row.
     */
    beginStream(streamId: string, sessionId: string): void {
        const now = new Date().toISOString();
        this.db.run(
            `INSERT OR IGNORE INTO streams (stream_id, session_id, started_at, ended_at, status)
             VALUES (?, ?, ?, NULL, 'active')`,
            [streamId, sessionId, now]
        );
    }

    /**
     * Append a stream chunk. The (stream_id, chunk_seq) composite key
     * guarantees ordering and prevents duplicate inserts on retry.
     * Payload is stored verbatim as JSON.
     */
    appendStreamChunk(streamId: string, chunkSeq: number, payload: unknown): void {
        const now = new Date().toISOString();
        this.db.run(
            `INSERT OR IGNORE INTO stream_log (stream_id, chunk_seq, payload, created_at)
             VALUES (?, ?, ?, ?)`,
            [streamId, chunkSeq, JSON.stringify(payload), now]
        );
    }

    /**
     * Mark a stream as completed or failed. Records the end timestamp so the
     * reconnect endpoint can apply a replay TTL.
     */
    endStream(streamId: string, status: 'completed' | 'failed'): void {
        const now = new Date().toISOString();
        this.db.run(
            `UPDATE streams SET ended_at = ?, status = ? WHERE stream_id = ?`,
            [now, status, streamId]
        );
    }

    /**
     * Read all chunks for a stream starting at `fromSeq` (inclusive).
     * Returns rows in ascending order — callers should replay them as-is.
     */
    readStreamChunks(streamId: string, fromSeq: number = 0): Array<{ chunkSeq: number; payload: unknown; createdAt: string }> {
        const rows = this.db.query(
            `SELECT chunk_seq, payload, created_at FROM stream_log
             WHERE stream_id = ? AND chunk_seq >= ?
             ORDER BY chunk_seq ASC`
        ).all(streamId, fromSeq) as Array<{ chunk_seq: number; payload: string; created_at: string }>;

        return rows.map(r => ({
            chunkSeq: r.chunk_seq,
            payload: this.parseStreamPayload(r.payload),
            createdAt: r.created_at,
        }));
    }

    /**
     * Look up stream metadata. Returns null if the stream is unknown.
     */
    getStreamMeta(streamId: string): { sessionId: string; startedAt: string; endedAt: string | null; status: string } | null {
        const row = this.db.query(
            `SELECT session_id, started_at, ended_at, status FROM streams WHERE stream_id = ?`
        ).get(streamId) as { session_id: string; started_at: string; ended_at: string | null; status: string } | undefined;
        if (!row) return null;
        return {
            sessionId: row.session_id,
            startedAt: row.started_at,
            endedAt: row.ended_at,
            status: row.status,
        };
    }

    /**
     * Most-recent stream for a session — used by the session-keyed reconnect
     * endpoint so the client can resume an interrupted run (after a sleep/wake)
     * knowing only the session id.
     */
    getLatestStream(sessionId: string): { streamId: string; startedAt: string; endedAt: string | null; status: string } | null {
        const row = this.db.query(
            `SELECT stream_id, started_at, ended_at, status FROM streams WHERE session_id = ? ORDER BY started_at DESC LIMIT 1`
        ).get(sessionId) as { stream_id: string; started_at: string; ended_at: string | null; status: string } | undefined;
        if (!row) return null;
        return { streamId: row.stream_id, startedAt: row.started_at, endedAt: row.ended_at, status: row.status };
    }

    /**
     * Garbage-collect old stream logs. Returns the number of chunks deleted.
     * Intended to be called on a periodic timer (e.g. the AgentRegistry
     * cleanup interval).
     */
    cleanupStreams(olderThanIso: string): number {
        let total = 0;
        this.db.transaction(() => {
            // Delete chunks first (FK semantics are not enforced but the
            // ordering makes the data consistent for outside observers).
            const chunkRes = this.db.run(
                `DELETE FROM stream_log WHERE created_at < ?`,
                [olderThanIso]
            );
            total += (chunkRes as unknown as { changes?: number }).changes ?? 0;
            this.db.run(
                `DELETE FROM streams WHERE (ended_at IS NOT NULL AND ended_at < ?)
                    OR (ended_at IS NULL AND started_at < ?)`,
                [olderThanIso, olderThanIso]
            );
        })();
        return total;
    }

    private parseStreamPayload(raw: string): unknown {
        try { return JSON.parse(raw); } catch { return raw; }
    }

    close() {
        this.db.close();
    }
}
