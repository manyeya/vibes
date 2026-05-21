import { Database } from "bun:sqlite";
import { AgentState, TodoItem, TaskItem, TaskTemplate } from "../core/types";
import * as path from "path";
import StateBackend from "./statebackend";

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
    private static readonly SCHEMA_VERSION = 1;

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

        // Future migrations: if (currentVersion < 2) { ... PRAGMA user_version = 2 }

        void SqliteBackend.SCHEMA_VERSION;

        // Ensure session exists
        const session = this.db.query("SELECT id FROM sessions WHERE id = ?").get(this.sessionId);
        if (!session) {
            const now = new Date().toISOString();
            this.db.run("INSERT INTO sessions (id, metadata, created_at, updated_at) VALUES (?, ?, ?, ?)",
                [this.sessionId, JSON.stringify({}), now, now]);
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
     * List all sessions with metadata
     */
    async listSessions(): Promise<SessionInfo[]> {
        const sessions = this.db.query(`
            SELECT s.id, s.summary, s.metadata, s.created_at, s.updated_at,
                   COUNT(DISTINCT m.id) as message_count
            FROM sessions s
            LEFT JOIN messages m ON s.id = m.session_id
            GROUP BY s.id
            ORDER BY s.updated_at DESC
        `).all() as any[];

        return sessions.map(row => ({
            id: row.id,
            summary: row.summary || undefined,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
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
            SELECT s.id, s.summary, s.metadata, s.created_at, s.updated_at,
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
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            messageCount: row.message_count || 0
        };
    }

    /**
     * Create a new session
     */
    async createSession(title?: string, metadata: Record<string, any> = {}): Promise<string> {
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const now = new Date().toISOString();

        const finalMetadata = title
            ? { ...metadata, title }
            : metadata;

        this.db.run(
            "INSERT INTO sessions (id, summary, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            [sessionId, null, JSON.stringify(finalMetadata), now, now]
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
    async updateSession(sessionId: string, updates: { title?: string; summary?: string; metadata?: Record<string, any> }): Promise<void> {
        const current = await this.getSession(sessionId);
        if (!current) return;

        const now = new Date().toISOString();
        const finalMetadata = updates.metadata || current.metadata || {};
        if (updates.title) {
            finalMetadata.title = updates.title;
        }

        this.db.run(
            `UPDATE sessions SET summary = ?, metadata = ?, updated_at = ? WHERE id = ?`,
            [
                updates.summary !== undefined ? updates.summary : current.summary || null,
                JSON.stringify(finalMetadata),
                now,
                sessionId
            ]
        );
    }

    close() {
        this.db.close();
    }
}
