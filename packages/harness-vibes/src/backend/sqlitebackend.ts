import { Database } from "bun:sqlite";
import { AgentState, TodoItem, TaskItem, TaskTemplate } from "../core/types";
import * as path from "path";

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
export default class SqliteBackend {
    private db: Database;
    private sessionId: string;

    constructor(dbPath: string = 'workspace/vibes.db', sessionId: string = 'default') {
        this.sessionId = sessionId;

        // Ensure directory exists sync-ish (constructor limitation)
        const dir = path.dirname(dbPath);
        const { exitCode } = Bun.spawnSync(["mkdir", "-p", dir]);

        this.db = new Database(dbPath);
        this.init();
    }

    private init() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                summary TEXT,
                metadata TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        `);

        // Add columns to existing sessions table if they don't exist (migration)
        // SQLite doesn't support DEFAULT in ALTER TABLE, so we add without default
        try {
            this.db.run(`ALTER TABLE sessions ADD COLUMN created_at TEXT`);
            // Set current timestamp for existing rows
            const now = new Date().toISOString();
            this.db.run(`UPDATE sessions SET created_at = ? WHERE created_at IS NULL`, [now]);
        } catch { /* Column already exists */ }
        try {
            this.db.run(`ALTER TABLE sessions ADD COLUMN updated_at TEXT`);
            // Set current timestamp for existing rows
            const now = new Date().toISOString();
            this.db.run(`UPDATE sessions SET updated_at = ? WHERE updated_at IS NULL`, [now]);
        } catch { /* Column already exists */ }

        this.db.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                role TEXT,
                content TEXT,
                FOREIGN KEY(session_id) REFERENCES sessions(id)
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                role TEXT,
                content TEXT,
                FOREIGN KEY(session_id) REFERENCES sessions(id)
            )
        `);

        // Ensure session exists
        const session = this.db.query("SELECT id FROM sessions WHERE id = ?").get(this.sessionId);
        if (!session) {
            const now = new Date().toISOString();
            this.db.run("INSERT INTO sessions (id, metadata, created_at, updated_at) VALUES (?, ?, ?, ?)",
                [this.sessionId, JSON.stringify({}), now, now]);
        }
    }

    /** Retrieves the full current state object */
    getState(): AgentState {
        const session = this.db.query("SELECT summary, metadata FROM sessions WHERE id = ?").get(this.sessionId) as any;
        const messages = this.db.query("SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC").all(this.sessionId) as any[];

        return {
            messages: messages.map(m => ({
                role: m.role,
                content: m.content.startsWith('[') || m.content.startsWith('{') ? JSON.parse(m.content) : m.content
            })) as any,
            metadata: JSON.parse(session?.metadata || '{}'),
            summary: session?.summary || undefined
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
                const insertMsg = this.db.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)");
                for (const msg of state.messages) {
                    insertMsg.run(this.sessionId, msg.role, typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
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
