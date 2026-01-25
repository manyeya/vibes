import { Database } from "bun:sqlite";
import { AgentState, TodoItem } from "../core/types";
import * as path from "node:path";

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
                metadata TEXT
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

        this.db.run(`
            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                title TEXT,
                status TEXT,
                priority TEXT,
                createdAt TEXT,
                FOREIGN KEY(session_id) REFERENCES sessions(id)
            )
        `);

        // Ensure session exists
        const session = this.db.query("SELECT id FROM sessions WHERE id = ?").get(this.sessionId);
        if (!session) {
            this.db.run("INSERT INTO sessions (id, metadata) VALUES (?, ?)", [this.sessionId, JSON.stringify({})]);
        }
    }

    /** Retrieves the full current state object */
    getState(): AgentState {
        const session = this.db.query("SELECT summary, metadata FROM sessions WHERE id = ?").get(this.sessionId) as any;
        const messages = this.db.query("SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC").all(this.sessionId) as any[];
        const todos = this.db.query("SELECT id, title, status, priority, createdAt FROM todos WHERE session_id = ?").all(this.sessionId) as any[];

        return {
            messages: messages.map(m => ({
                role: m.role,
                content: m.content.startsWith('[') || m.content.startsWith('{') ? JSON.parse(m.content) : m.content
            })) as any,
            todos: todos as TodoItem[],
            metadata: JSON.parse(session?.metadata || '{}'),
            summary: session?.summary || undefined
        };
    }

    /** Partially updates the internal state */
    setState(state: Partial<AgentState>): void {
        this.db.transaction(() => {
            if (state.summary !== undefined) {
                this.db.run("UPDATE sessions SET summary = ? WHERE id = ?", [state.summary, this.sessionId]);
            }
            if (state.metadata !== undefined) {
                this.db.run("UPDATE sessions SET metadata = ? WHERE id = ?", [JSON.stringify(state.metadata), this.sessionId]);
            }
            if (state.messages !== undefined) {
                // For simplicity in this implementation, we overwrite the message log for state synchronization
                // In a high-perf scenario, we would only append. 
                // However, agent.ts often sets the whole array (e.g. after summarization).
                this.db.run("DELETE FROM messages WHERE session_id = ?", [this.sessionId]);
                const insertMsg = this.db.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)");
                for (const msg of state.messages) {
                    insertMsg.run(this.sessionId, msg.role, typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
                }
            }
            if (state.todos !== undefined) {
                this.db.run("DELETE FROM todos WHERE session_id = ?", [this.sessionId]);
                const insertTodo = this.db.prepare("INSERT INTO todos (id, session_id, title, status, priority, createdAt) VALUES (?, ?, ?, ?, ?, ?)");
                for (const todo of state.todos) {
                    insertTodo.run(todo.id, this.sessionId, todo.title, todo.status, todo.priority, todo.createdAt);
                }
            }
        })();
    }

    // Todo operations

    async addTodo(todo: TodoItem): Promise<void> {
        this.db.run(
            "INSERT INTO todos (id, session_id, title, status, priority, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
            [todo.id, this.sessionId, todo.title, todo.status, todo.priority, todo.createdAt]
        );
    }

    async updateTodo(id: string, updates: Partial<TodoItem>): Promise<void> {
        const current = this.db.query("SELECT * FROM todos WHERE id = ?").get(id) as any;
        if (current) {
            const merged = { ...current, ...updates };
            this.db.run(
                "UPDATE todos SET title = ?, status = ?, priority = ? WHERE id = ?",
                [merged.title, merged.status, merged.priority, id]
            );
        }
    }

    async getTodos(): Promise<TodoItem[]> {
        return this.db.query("SELECT * FROM todos WHERE session_id = ?").all(this.sessionId) as any[];
    }

    async getPendingTodos(): Promise<TodoItem[]> {
        return this.db.query("SELECT * FROM todos WHERE session_id = ? AND status != 'completed'").all(this.sessionId) as any[];
    }

    async getFirstPendingTodo(): Promise<TodoItem | null> {
        return this.db.query("SELECT * FROM todos WHERE session_id = ? AND (status = 'pending' || status = 'in_progress') LIMIT 1").get(this.sessionId) as any || null;
    }

    async hasPendingTodos(): Promise<boolean> {
        const count = this.db.query("SELECT COUNT(*) as count FROM todos WHERE session_id = ? AND status != 'completed'").get(this.sessionId) as any;
        return count.count > 0;
    }

    async clearTodos(): Promise<void> {
        this.db.run("DELETE FROM todos WHERE session_id = ?", [this.sessionId]);
    }

    close() {
        this.db.close();
    }
}
