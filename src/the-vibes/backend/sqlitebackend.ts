import { Database } from "bun:sqlite";
import { AgentState, TodoItem, TaskItem, TaskTemplate } from "../core/types";
import * as path from "path";

/**
 * Result from execution order calculation
 */
interface ExecutionLevel {
    level: number;
    tasks: TaskItem[];
}

/**
 * File entry for tracking files created/modified during a session
 */
export interface FileEntry {
    id: string;
    sessionId: string;
    path: string;
    type: string;
    createdAt: string;
}

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
    taskCount?: number;
    fileCount?: number;
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

        this.db.run(`
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                priority TEXT NOT NULL DEFAULT 'medium',
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL,
                completedAt TEXT,
                blocks TEXT DEFAULT '[]',
                blockedBy TEXT DEFAULT '[]',
                fileReferences TEXT DEFAULT '[]',
                taskReferences TEXT DEFAULT '[]',
                urlReferences TEXT DEFAULT '[]',
                templateId TEXT,
                metadata TEXT DEFAULT '{}',
                error TEXT,
                complexity INTEGER,
                owner TEXT,
                tags TEXT DEFAULT '[]',
                FOREIGN KEY(session_id) REFERENCES sessions(id)
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS task_templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                baseTask TEXT NOT NULL DEFAULT '{}',
                parameters TEXT NOT NULL DEFAULT '[]',
                subTasks TEXT DEFAULT '[]',
                defaultFilePatterns TEXT DEFAULT '[]',
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                path TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'unknown',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(session_id, path),
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        `);

        // Indexes for common queries
        this.db.run(`
            CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id)
        `);
        this.db.run(`
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)
        `);
        this.db.run(`
            CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority)
        `);
        this.db.run(`
            CREATE INDEX IF NOT EXISTS idx_files_session ON files(session_id)
        `);

        // Initialize built-in templates if they don't exist
        this.initBuiltInTemplates();

        // Ensure session exists
        const session = this.db.query("SELECT id FROM sessions WHERE id = ?").get(this.sessionId);
        if (!session) {
            const now = new Date().toISOString();
            this.db.run("INSERT INTO sessions (id, metadata, created_at, updated_at) VALUES (?, ?, ?, ?)",
                [this.sessionId, JSON.stringify({}), now, now]);
        }
    }

    /**
     * Initialize built-in task templates
     */
    private initBuiltInTemplates() {
        const now = new Date().toISOString();
        const builtInTemplates = [
            {
                id: 'feature_dev',
                name: 'Feature Development',
                description: 'Standard workflow for implementing new features',
                baseTask: JSON.stringify({
                    title: '${featureName}: Feature Development',
                    description: 'Implement the ${featureName} feature following best practices',
                    priority: 'medium',
                    tags: ['feature', 'development']
                }),
                parameters: JSON.stringify([
                    { name: 'featureName', description: 'Name of the feature to implement', required: true }
                ]),
                subTasks: JSON.stringify([
                    {
                        title: 'Analyze requirements for ${featureName}',
                        description: 'Review requirements, identify edge cases, and plan implementation approach',
                        status: 'pending',
                        priority: 'high',
                        tags: ['analysis']
                    },
                    {
                        title: 'Implement ${featureName} core logic',
                        description: 'Write the main implementation code for the feature',
                        status: 'pending',
                        priority: 'high',
                        tags: ['implementation']
                    },
                    {
                        title: 'Write tests for ${featureName}',
                        description: 'Create comprehensive tests covering edge cases',
                        status: 'pending',
                        priority: 'medium',
                        tags: ['testing']
                    },
                    {
                        title: 'Document ${featureName}',
                        description: 'Add documentation, comments, and usage examples',
                        status: 'pending',
                        priority: 'low',
                        tags: ['documentation']
                    }
                ]),
                defaultFilePatterns: JSON.stringify(['src/**/*.ts', 'tests/**/*.ts']),
                createdAt: now,
                updatedAt: now
            },
            {
                id: 'bugfix',
                name: 'Bug Fix',
                description: 'Standard workflow for fixing bugs',
                baseTask: JSON.stringify({
                    title: '${bugDescription}: Bug Fix',
                    description: 'Fix the bug: ${bugDescription}',
                    priority: 'high',
                    tags: ['bugfix']
                }),
                parameters: JSON.stringify([
                    { name: 'bugDescription', description: 'Description of the bug to fix', required: true }
                ]),
                subTasks: JSON.stringify([
                    {
                        title: 'Reproduce the bug',
                        description: 'Create a minimal reproduction of the bug to understand the root cause',
                        status: 'pending',
                        priority: 'high',
                        tags: ['reproduction']
                    },
                    {
                        title: 'Identify root cause',
                        description: 'Analyze the code to find the root cause of the bug',
                        status: 'pending',
                        priority: 'high',
                        tags: ['analysis']
                    },
                    {
                        title: 'Implement fix',
                        description: 'Write the fix for the identified issue',
                        status: 'pending',
                        priority: 'high',
                        tags: ['fix']
                    },
                    {
                        title: 'Verify fix works',
                        description: 'Test the fix to ensure it resolves the issue without side effects',
                        status: 'pending',
                        priority: 'high',
                        tags: ['verification']
                    }
                ]),
                defaultFilePatterns: JSON.stringify(['src/**/*.ts']),
                createdAt: now,
                updatedAt: now
            },
            {
                id: 'research',
                name: 'Research Task',
                description: 'Standard workflow for research and investigation',
                baseTask: JSON.stringify({
                    title: '${topic}: Research',
                    description: 'Research and investigate: ${topic}',
                    priority: 'medium',
                    tags: ['research']
                }),
                parameters: JSON.stringify([
                    { name: 'topic', description: 'Topic to research', required: true }
                ]),
                subTasks: JSON.stringify([
                    {
                        title: 'Gather sources for ${topic}',
                        description: 'Collect relevant documentation, code, and resources',
                        status: 'pending',
                        priority: 'high',
                        tags: ['gathering']
                    },
                    {
                        title: 'Analyze findings',
                        description: 'Analyze the gathered information and extract key insights',
                        status: 'pending',
                        priority: 'high',
                        tags: ['analysis']
                    },
                    {
                        title: 'Document findings',
                        description: 'Create comprehensive documentation of findings and conclusions',
                        status: 'pending',
                        priority: 'medium',
                        tags: ['documentation']
                    }
                ]),
                defaultFilePatterns: JSON.stringify([]),
                createdAt: now,
                updatedAt: now
            }
        ];

        const insertTemplate = this.db.prepare(`
            INSERT OR IGNORE INTO task_templates
            (id, name, description, baseTask, parameters, subTasks, defaultFilePatterns, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const template of builtInTemplates) {
            insertTemplate.run(
                template.id,
                template.name,
                template.description,
                template.baseTask,
                template.parameters,
                template.subTasks,
                template.defaultFilePatterns,
                template.createdAt,
                template.updatedAt
            );
        }
    }

    /** Retrieves the full current state object */
    getState(): AgentState {
        const session = this.db.query("SELECT summary, metadata FROM sessions WHERE id = ?").get(this.sessionId) as any;
        const messages = this.db.query("SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC").all(this.sessionId) as any[];
        const todos = this.db.query("SELECT id, title, status, priority, createdAt FROM todos WHERE session_id = ?").all(this.sessionId) as any[];
        const tasks = this.db.query("SELECT * FROM tasks WHERE session_id = ?").all(this.sessionId) as any[];

        return {
            messages: messages.map(m => ({
                role: m.role,
                content: m.content.startsWith('[') || m.content.startsWith('{') ? JSON.parse(m.content) : m.content
            })) as any,
            todos: todos as TodoItem[],
            tasks: tasks.map(row => this.parseTaskRow(row)) as TaskItem[],
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
            if (state.tasks !== undefined) {
                this.db.run("DELETE FROM tasks WHERE session_id = ?", [this.sessionId]);
                const insertTask = this.db.prepare(`
                    INSERT INTO tasks (id, session_id, title, description, status, priority, createdAt, updatedAt, completedAt,
                        blocks, blockedBy, fileReferences, taskReferences, urlReferences, templateId, metadata, error, complexity, owner, tags)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                for (const task of state.tasks) {
                    insertTask.run(
                        task.id, this.sessionId, task.title, task.description, task.status, task.priority,
                        task.createdAt, task.updatedAt, task.completedAt || null,
                        JSON.stringify(task.blocks), JSON.stringify(task.blockedBy),
                        JSON.stringify(task.fileReferences), JSON.stringify(task.taskReferences),
                        JSON.stringify(task.urlReferences), task.templateId || null,
                        JSON.stringify(task.metadata), task.error || null,
                        task.complexity || null, task.owner || null,
                        JSON.stringify(task.tags)
                    );
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

    // Task operations

    /**
     * Convert a database row to a TaskItem
     */
    private parseTaskRow(row: any): TaskItem {
        return {
            id: row.id,
            title: row.title,
            description: row.description || '',
            status: row.status,
            priority: row.priority,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            completedAt: row.completedAt || undefined,
            blocks: JSON.parse(row.blocks || '[]'),
            blockedBy: JSON.parse(row.blockedBy || '[]'),
            fileReferences: JSON.parse(row.fileReferences || '[]'),
            taskReferences: JSON.parse(row.taskReferences || '[]'),
            urlReferences: JSON.parse(row.urlReferences || '[]'),
            templateId: row.templateId || undefined,
            metadata: JSON.parse(row.metadata || '{}'),
            error: row.error || undefined,
            complexity: row.complexity || undefined,
            owner: row.owner || undefined,
            tags: JSON.parse(row.tags || '[]'),
        };
    }

    /**
     * Add a single task to the database
     */
    async addTask(task: TaskItem): Promise<void> {
        this.db.run(
            `INSERT INTO tasks (id, session_id, title, description, status, priority, createdAt, updatedAt, completedAt,
                blocks, blockedBy, fileReferences, taskReferences, urlReferences, templateId, metadata, error, complexity, owner, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                task.id, this.sessionId, task.title, task.description, task.status, task.priority,
                task.createdAt, task.updatedAt, task.completedAt || null,
                JSON.stringify(task.blocks), JSON.stringify(task.blockedBy),
                JSON.stringify(task.fileReferences), JSON.stringify(task.taskReferences),
                JSON.stringify(task.urlReferences), task.templateId || null,
                JSON.stringify(task.metadata), task.error || null,
                task.complexity || null, task.owner || null,
                JSON.stringify(task.tags)
            ]
        );
    }

    /**
     * Add multiple tasks in a single transaction
     */
    async addTasks(tasks: TaskItem[]): Promise<void> {
        const stmt = this.db.prepare(
            `INSERT INTO tasks (id, session_id, title, description, status, priority, createdAt, updatedAt, completedAt,
                blocks, blockedBy, fileReferences, taskReferences, urlReferences, templateId, metadata, error, complexity, owner, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        this.db.transaction(() => {
            for (const task of tasks) {
                stmt.run(
                    task.id, this.sessionId, task.title, task.description, task.status, task.priority,
                    task.createdAt, task.updatedAt, task.completedAt || null,
                    JSON.stringify(task.blocks), JSON.stringify(task.blockedBy),
                    JSON.stringify(task.fileReferences), JSON.stringify(task.taskReferences),
                    JSON.stringify(task.urlReferences), task.templateId || null,
                    JSON.stringify(task.metadata), task.error || null,
                    task.complexity || null, task.owner || null,
                    JSON.stringify(task.tags)
                );
            }
        })();
    }

    /**
     * Update an existing task
     */
    async updateTask(id: string, updates: Partial<Omit<TaskItem, 'id' | 'createdAt'>>): Promise<void> {
        const current = await this.getTask(id);
        if (!current) return;

        const updated: TaskItem = {
            ...current,
            ...updates,
            id: current.id,
            createdAt: current.createdAt,
            updatedAt: new Date().toISOString(),
        };

        // If status changed to completed, set completedAt
        if (updates.status === 'completed' && current.status !== 'completed') {
            updated.completedAt = new Date().toISOString();
        }

        // If status changed from completed to something else, clear completedAt
        if (updates.status && updates.status !== 'completed' && current.status === 'completed') {
            updated.completedAt = undefined;
        }

        this.db.run(
            `UPDATE tasks SET
                title = ?, description = ?, status = ?, priority = ?, updatedAt = ?, completedAt = ?,
                blocks = ?, blockedBy = ?, fileReferences = ?, taskReferences = ?, urlReferences = ?,
                templateId = ?, metadata = ?, error = ?, complexity = ?, owner = ?, tags = ?
            WHERE id = ?`,
            [
                updated.title, updated.description, updated.status, updated.priority, updated.updatedAt, updated.completedAt || null,
                JSON.stringify(updated.blocks), JSON.stringify(updated.blockedBy),
                JSON.stringify(updated.fileReferences), JSON.stringify(updated.taskReferences),
                JSON.stringify(updated.urlReferences), updated.templateId || null,
                JSON.stringify(updated.metadata), updated.error || null,
                updated.complexity || null, updated.owner || null,
                JSON.stringify(updated.tags),
                id
            ]
        );

        // Auto-unblock dependent tasks when completing
        if (updated.status === 'completed' && current.status !== 'completed') {
            await this.unblockDependentTasks(id);
        }

        // Re-block dependent tasks if un-completing
        if (updates.status && updates.status !== 'completed' && current.status === 'completed') {
            await this.reblockDependentTasks(id);
        }
    }

    /**
     * Get a single task by ID
     */
    async getTask(id: string): Promise<TaskItem | null> {
        const row = this.db.query("SELECT * FROM tasks WHERE id = ? AND session_id = ?").get(id, this.sessionId) as any;
        return row ? this.parseTaskRow(row) : null;
    }

    /**
     * Get all tasks for the current session
     */
    async getTasks(): Promise<TaskItem[]> {
        const rows = this.db.query("SELECT * FROM tasks WHERE session_id = ?").all(this.sessionId) as any[];
        return rows.map(row => this.parseTaskRow(row));
    }

    /**
     * Get tasks by IDs
     */
    async getTasksByIds(ids: string[]): Promise<TaskItem[]> {
        if (ids.length === 0) return [];
        const placeholders = ids.map(() => '?').join(',');
        const rows = this.db.query(`SELECT * FROM tasks WHERE id IN (${placeholders}) AND session_id = ?`).all(...ids, this.sessionId) as any[];
        return rows.map(row => this.parseTaskRow(row));
    }

    /**
     * Get blocked tasks (status = 'blocked')
     */
    async getBlockedTasks(): Promise<TaskItem[]> {
        const rows = this.db.query("SELECT * FROM tasks WHERE session_id = ? AND status = 'blocked'").all(this.sessionId) as any[];
        return rows.map(row => this.parseTaskRow(row));
    }

    /**
     * Get pending tasks (status != 'completed')
     */
    async getPendingTasks(): Promise<TaskItem[]> {
        const rows = this.db.query("SELECT * FROM tasks WHERE session_id = ? AND status != 'completed'").all(this.sessionId) as any[];
        return rows.map(row => this.parseTaskRow(row));
    }

    /**
     * Get available tasks (can be started - not blocked and not completed)
     */
    async getAvailableTasks(): Promise<TaskItem[]> {
        const rows = this.db.query(
            "SELECT * FROM tasks WHERE session_id = ? AND status IN ('pending', 'in_progress')"
        ).all(this.sessionId) as any[];
        const tasks = rows.map(row => this.parseTaskRow(row));

        // Filter out tasks that have uncompleted dependencies
        const allTasks = await this.getTasks();
        const completedIds = new Set(allTasks.filter(t => t.status === 'completed').map(t => t.id));

        return tasks.filter(task => {
            return task.blockedBy.every(depId => completedIds.has(depId));
        });
    }

    /**
     * Delete a task with optional cascade (delete tasks that only depend on this one)
     */
    async deleteTask(id: string, cascade: boolean = false): Promise<void> {
        if (cascade) {
            // Delete tasks that are only blocked by this task
            const tasks = await this.getTasks();
            const toDelete = [id];

            for (const task of tasks) {
                if (task.blockedBy.length === 1 && task.blockedBy[0] === id) {
                    toDelete.push(task.id);
                }
            }

            for (const deleteId of toDelete) {
                this.db.run("DELETE FROM tasks WHERE id = ? AND session_id = ?", [deleteId, this.sessionId]);
            }
        } else {
            this.db.run("DELETE FROM tasks WHERE id = ? AND session_id = ?", [id, this.sessionId]);

            // Remove this task from blockedBy of other tasks
            const tasks = await this.getTasks();
            for (const task of tasks) {
                if (task.blockedBy.includes(id)) {
                    await this.updateTask(task.id, {
                        blockedBy: task.blockedBy.filter(b => b !== id)
                    });
                }
            }
        }
    }

    /**
     * Clear all tasks for the current session
     */
    async clearTasks(): Promise<void> {
        this.db.run("DELETE FROM tasks WHERE session_id = ?", [this.sessionId]);
    }

    /**
     * Unblock dependent tasks when a task completes
     */
    private async unblockDependentTasks(completedTaskId: string): Promise<void> {
        const tasks = await this.getTasks();
        const completedTasks = tasks.filter(t => t.status === 'completed');
        const completedIds = new Set(completedTasks.map(t => t.id));

        for (const task of tasks) {
            if (task.blockedBy.includes(completedTaskId) && task.status === 'blocked') {
                // Check if all dependencies are now complete
                const allDepsComplete = task.blockedBy.every(depId => completedIds.has(depId));
                if (allDepsComplete && task.blockedBy.length > 0) {
                    await this.updateTask(task.id, { status: 'pending' });
                }
            }
        }
    }

    /**
     * Re-block dependent tasks when a task is un-completed
     */
    private async reblockDependentTasks(uncompletedTaskId: string): Promise<void> {
        const tasks = await this.getTasks();

        for (const task of tasks) {
            if (task.blockedBy.includes(uncompletedTaskId) && task.status !== 'blocked') {
                await this.updateTask(task.id, { status: 'blocked' });
            }
        }
    }

    /**
     * Derive execution order using topological sort with level detection
     */
    async getExecutionOrder(): Promise<ExecutionLevel[]> {
        const tasks = await this.getTasks();
        const pendingTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
        const completedIds = new Set(tasks.filter(t => t.status === 'completed').map(t => t.id));

        // Build adjacency list and in-degree count
        const taskMap = new Map(pendingTasks.map(t => [t.id, t]));
        const inDegree = new Map<string, number>();
        const dependents = new Map<string, string[]>();

        for (const task of pendingTasks) {
            inDegree.set(task.id, 0);
            dependents.set(task.id, []);
        }

        for (const task of pendingTasks) {
            // Only count uncompleted dependencies
            const uncompletedDeps = task.blockedBy.filter(depId => !completedIds.has(depId));
            inDegree.set(task.id, uncompletedDeps.length);

            for (const depId of uncompletedDeps) {
                if (dependents.has(depId)) {
                    dependents.get(depId)!.push(task.id);
                }
            }
        }

        const result: ExecutionLevel[] = [];
        let currentLevel: string[] = [];

        // Find tasks with no uncompleted dependencies
        for (const [id, degree] of inDegree) {
            if (degree === 0 && taskMap.get(id)?.status !== 'blocked') {
                currentLevel.push(id);
            }
        }

        let levelNum = 0;
        while (currentLevel.length > 0) {
            const levelTasks = currentLevel.map(id => taskMap.get(id)!).filter(Boolean);
            result.push({ level: levelNum, tasks: levelTasks });

            const nextLevel: string[] = [];
            for (const taskId of currentLevel) {
                for (const depId of dependents.get(taskId) || []) {
                    const newDegree = (inDegree.get(depId) || 0) - 1;
                    inDegree.set(depId, newDegree);
                    if (newDegree === 0) {
                        nextLevel.push(depId);
                    }
                }
            }

            currentLevel = nextLevel;
            levelNum++;
        }

        // Handle cycles - remaining tasks go to the end
        const remaining = Array.from(taskMap.values()).filter(t =>
            !result.some(level => level.tasks.some(lt => lt.id === t.id))
        );
        if (remaining.length > 0) {
            result.push({ level: levelNum, tasks: remaining });
        }

        return result;
    }

    // Template operations

    /**
     * Save a task template
     */
    async saveTemplate(template: TaskTemplate): Promise<void> {
        const now = new Date().toISOString();
        const existing = this.db.query("SELECT id FROM task_templates WHERE id = ?").get(template.id) as any;

        if (existing) {
            this.db.run(
                `UPDATE task_templates SET name = ?, description = ?, baseTask = ?, parameters = ?, subTasks = ?, defaultFilePatterns = ?, updatedAt = ? WHERE id = ?`,
                [
                    template.name,
                    template.description,
                    JSON.stringify(template.baseTask),
                    JSON.stringify(template.parameters),
                    JSON.stringify(template.subTasks || []),
                    JSON.stringify(template.defaultFilePatterns || []),
                    now,
                    template.id
                ]
            );
        } else {
            this.db.run(
                `INSERT INTO task_templates (id, name, description, baseTask, parameters, subTasks, defaultFilePatterns, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    template.id,
                    template.name,
                    template.description,
                    JSON.stringify(template.baseTask),
                    JSON.stringify(template.parameters),
                    JSON.stringify(template.subTasks || []),
                    JSON.stringify(template.defaultFilePatterns || []),
                    now,
                    now
                ]
            );
        }
    }

    /**
     * Get a template by ID
     */
    async getTemplate(id: string): Promise<TaskTemplate | null> {
        const row = this.db.query("SELECT * FROM task_templates WHERE id = ?").get(id) as any;
        if (!row) return null;

        return {
            id: row.id,
            name: row.name,
            description: row.description,
            baseTask: JSON.parse(row.baseTask),
            parameters: JSON.parse(row.parameters),
            subTasks: row.subTasks ? JSON.parse(row.subTasks) : undefined,
            defaultFilePatterns: row.defaultFilePatterns ? JSON.parse(row.defaultFilePatterns) : undefined,
        };
    }

    /**
     * List all templates
     */
    async listTemplates(): Promise<TaskTemplate[]> {
        const rows = this.db.query("SELECT * FROM task_templates").all() as any[];
        return rows.map(row => ({
            id: row.id,
            name: row.name,
            description: row.description,
            baseTask: JSON.parse(row.baseTask),
            parameters: JSON.parse(row.parameters),
            subTasks: row.subTasks ? JSON.parse(row.subTasks) : undefined,
            defaultFilePatterns: row.defaultFilePatterns ? JSON.parse(row.defaultFilePatterns) : undefined,
        }));
    }

    /**
     * Delete a template (only custom templates, not built-in)
     */
    async deleteTemplate(id: string): Promise<void> {
        const builtInIds = ['feature_dev', 'bugfix', 'research'];
        if (builtInIds.includes(id)) {
            throw new Error('Cannot delete built-in templates');
        }
        this.db.run("DELETE FROM task_templates WHERE id = ?", [id]);
    }

    /**
     * Apply a template with parameter substitution
     */
    async applyTemplate(templateId: string, parameters: Record<string, any>, title?: string): Promise<TaskItem[]> {
        const template = await this.getTemplate(templateId);
        if (!template) {
            throw new Error(`Template not found: ${templateId}`);
        }

        const now = new Date().toISOString();
        const tasks: TaskItem[] = [];

        // Helper to substitute parameters in a string
        const substitute = (str: string): string => {
            return str.replace(/\$\{(\w+)\}/g, (_, key) => parameters[key] || '');
        };

        // Create main task
        const mainTask: TaskItem = {
            id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            title: title || substitute(template.baseTask.title || `${templateId} Task`),
            description: substitute(template.baseTask.description || ''),
            status: 'pending',
            priority: template.baseTask.priority || 'medium',
            createdAt: now,
            updatedAt: now,
            blocks: [],
            blockedBy: template.baseTask.blockedBy || [],
            fileReferences: template.baseTask.fileReferences || [],
            taskReferences: template.baseTask.taskReferences || [],
            urlReferences: template.baseTask.urlReferences || [],
            templateId: templateId,
            metadata: template.baseTask.metadata || {},
            tags: template.baseTask.tags || [],
        };

        // Check if task should be blocked (has dependencies)
        if (mainTask.blockedBy.length > 0) {
            mainTask.status = 'blocked';
        }

        tasks.push(mainTask);

        // Create sub-tasks
        if (template.subTasks) {
            let lastSubTaskId = mainTask.id;

            for (const subTaskDef of template.subTasks) {
                const subTask: TaskItem = {
                    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
                    title: substitute(subTaskDef.title || ''),
                    description: substitute(subTaskDef.description || ''),
                    status: 'pending',
                    priority: subTaskDef.priority || 'medium',
                    createdAt: now,
                    updatedAt: now,
                    blocks: [],
                    blockedBy: [lastSubTaskId], // Chain dependencies
                    fileReferences: subTaskDef.fileReferences || [],
                    taskReferences: subTaskDef.taskReferences || [],
                    urlReferences: subTaskDef.urlReferences || [],
                    metadata: subTaskDef.metadata || {},
                    tags: subTaskDef.tags || [],
                };

                // First sub-task is blocked by main task, others by previous sub-task
                if (tasks.length === 1) {
                    subTask.blockedBy = [mainTask.id];
                } else {
                    subTask.blockedBy = [lastSubTaskId];
                }

                subTask.status = 'blocked'; // Will be unblocked when dependency completes
                mainTask.blocks.push(subTask.id); // Main task blocks this sub-task

                tasks.push(subTask);
                lastSubTaskId = subTask.id;
            }
        }

        // Add default file patterns if specified
        if (template.defaultFilePatterns) {
            for (const task of tasks) {
                task.fileReferences.push(...template.defaultFilePatterns);
            }
        }

        // Save all tasks
        await this.addTasks(tasks);

        return tasks;
    }

    // File operations

    /**
     * Register a file as created/modified in the current session
     */
    async addFile(filePath: string, fileType: string = 'unknown'): Promise<void> {
        const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const now = new Date().toISOString();

        // Insert or replace (update timestamp if file already exists for this session)
        this.db.run(
            `INSERT OR REPLACE INTO files (id, session_id, path, type, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [fileId, this.sessionId, filePath, fileType, now]
        );

        // Update session's updated_at timestamp
        this.db.run("UPDATE sessions SET updated_at = ? WHERE id = ?", [now, this.sessionId]);
    }

    /**
     * Get all files for the current session
     */
    async getFiles(): Promise<FileEntry[]> {
        const rows = this.db.query(
            "SELECT id, session_id, path, type, created_at FROM files WHERE session_id = ? ORDER BY created_at DESC"
        ).all(this.sessionId) as any[];

        return rows.map(row => ({
            id: row.id,
            sessionId: row.session_id,
            path: row.path,
            type: row.type,
            createdAt: row.created_at
        }));
    }

    /**
     * Delete a file record from the current session
     */
    async deleteFile(filePath: string): Promise<void> {
        this.db.run("DELETE FROM files WHERE session_id = ? AND path = ?", [this.sessionId, filePath]);
    }

    /**
     * Clear all file records for the current session
     */
    async clearFiles(): Promise<void> {
        this.db.run("DELETE FROM files WHERE session_id = ?", [this.sessionId]);
    }

    // Session management operations

    /**
     * List all sessions with metadata
     */
    async listSessions(): Promise<SessionInfo[]> {
        const sessions = this.db.query(`
            SELECT s.id, s.summary, s.metadata, s.created_at, s.updated_at,
                   COUNT(DISTINCT m.id) as message_count,
                   COUNT(DISTINCT t.id) as task_count,
                   COUNT(DISTINCT f.id) as file_count
            FROM sessions s
            LEFT JOIN messages m ON s.id = m.session_id
            LEFT JOIN tasks t ON s.id = t.session_id
            LEFT JOIN files f ON s.id = f.session_id
            GROUP BY s.id
            ORDER BY s.updated_at DESC
        `).all() as any[];

        return sessions.map(row => ({
            id: row.id,
            summary: row.summary || undefined,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            messageCount: row.message_count || 0,
            taskCount: row.task_count || 0,
            fileCount: row.file_count || 0
        }));
    }

    /**
     * Get a specific session's metadata
     */
    async getSession(sessionId: string): Promise<SessionInfo | null> {
        const row = this.db.query(`
            SELECT s.id, s.summary, s.metadata, s.created_at, s.updated_at,
                   COUNT(DISTINCT m.id) as message_count,
                   COUNT(DISTINCT t.id) as task_count,
                   COUNT(DISTINCT f.id) as file_count
            FROM sessions s
            LEFT JOIN messages m ON s.id = m.session_id
            LEFT JOIN tasks t ON s.id = t.session_id
            LEFT JOIN files f ON s.id = f.session_id
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
            messageCount: row.message_count || 0,
            taskCount: row.task_count || 0,
            fileCount: row.file_count || 0
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
            // Files will be deleted automatically due to ON DELETE CASCADE
            this.db.run("DELETE FROM messages WHERE session_id = ?", [sessionId]);
            this.db.run("DELETE FROM todos WHERE session_id = ?", [sessionId]);
            this.db.run("DELETE FROM tasks WHERE session_id = ?", [sessionId]);
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
