import { AgentState, TodoItem, TaskItem, TaskTemplate } from "../core/types";

/**
 * Result from execution order calculation
 */
interface ExecutionLevel {
    level: number;
    tasks: TaskItem[];
}

/**
 * Internal state manager for the agent. Handles conversation history,
 * virtual file storage, and structured todo list data.
 */
export default class StateBackend {
    private state: AgentState;

    // Built-in templates storage (shared across sessions)
    private templates: Map<string, TaskTemplate> = new Map();

    constructor() {
        this.state = {
            messages: [],
            todos: [],
            tasks: [],
            metadata: {},
        };
        this.initBuiltInTemplates();
    }

    /**
     * Initialize built-in task templates
     */
    private initBuiltInTemplates() {
        const featureDevTemplate: TaskTemplate = {
            id: 'feature_dev',
            name: 'Feature Development',
            description: 'Standard workflow for implementing new features',
            baseTask: {
                title: '${featureName}: Feature Development',
                description: 'Implement the ${featureName} feature following best practices',
                priority: 'medium',
                tags: ['feature', 'development'],
                blocks: [],
                blockedBy: [],
                fileReferences: [],
                taskReferences: [],
                urlReferences: [],
                metadata: {}
            },
            parameters: [
                { name: 'featureName', description: 'Name of the feature to implement', required: true }
            ],
            subTasks: [
                {
                    title: 'Analyze requirements for ${featureName}',
                    description: 'Review requirements, identify edge cases, and plan implementation approach',
                    status: 'pending',
                    priority: 'high',
                    tags: ['analysis'],
                    blocks: [],
                    blockedBy: [],
                    fileReferences: [],
                    taskReferences: [],
                    urlReferences: [],
                    metadata: {}
                },
                {
                    title: 'Implement ${featureName} core logic',
                    description: 'Write the main implementation code for the feature',
                    status: 'pending',
                    priority: 'high',
                    tags: ['implementation'],
                    blocks: [],
                    blockedBy: [],
                    fileReferences: [],
                    taskReferences: [],
                    urlReferences: [],
                    metadata: {}
                },
                {
                    title: 'Write tests for ${featureName}',
                    description: 'Create comprehensive tests covering edge cases',
                    status: 'pending',
                    priority: 'medium',
                    tags: ['testing'],
                    blocks: [],
                    blockedBy: [],
                    fileReferences: [],
                    taskReferences: [],
                    urlReferences: [],
                    metadata: {}
                },
                {
                    title: 'Document ${featureName}',
                    description: 'Add documentation, comments, and usage examples',
                    status: 'pending',
                    priority: 'low',
                    tags: ['documentation'],
                    blocks: [],
                    blockedBy: [],
                    fileReferences: [],
                    taskReferences: [],
                    urlReferences: [],
                    metadata: {}
                }
            ],
            defaultFilePatterns: ['src/**/*.ts', 'tests/**/*.ts']
        };

        const bugfixTemplate: TaskTemplate = {
            id: 'bugfix',
            name: 'Bug Fix',
            description: 'Standard workflow for fixing bugs',
            baseTask: {
                title: '${bugDescription}: Bug Fix',
                description: 'Fix the bug: ${bugDescription}',
                priority: 'high',
                tags: ['bugfix'],
                blocks: [],
                blockedBy: [],
                fileReferences: [],
                taskReferences: [],
                urlReferences: [],
                metadata: {}
            },
            parameters: [
                { name: 'bugDescription', description: 'Description of the bug to fix', required: true }
            ],
            subTasks: [
                {
                    title: 'Reproduce the bug',
                    description: 'Create a minimal reproduction of the bug to understand the root cause',
                    status: 'pending',
                    priority: 'high',
                    tags: ['reproduction'],
                    blocks: [],
                    blockedBy: [],
                    fileReferences: [],
                    taskReferences: [],
                    urlReferences: [],
                    metadata: {}
                },
                {
                    title: 'Identify root cause',
                    description: 'Analyze the code to find the root cause of the bug',
                    status: 'pending',
                    priority: 'high',
                    tags: ['analysis'],
                    blocks: [],
                    blockedBy: [],
                    fileReferences: [],
                    taskReferences: [],
                    urlReferences: [],
                    metadata: {}
                },
                {
                    title: 'Implement fix',
                    description: 'Write the fix for the identified issue',
                    status: 'pending',
                    priority: 'high',
                    tags: ['fix'],
                    blocks: [],
                    blockedBy: [],
                    fileReferences: [],
                    taskReferences: [],
                    urlReferences: [],
                    metadata: {}
                },
                {
                    title: 'Verify fix works',
                    description: 'Test the fix to ensure it resolves the issue without side effects',
                    status: 'pending',
                    priority: 'high',
                    tags: ['verification'],
                    blocks: [],
                    blockedBy: [],
                    fileReferences: [],
                    taskReferences: [],
                    urlReferences: [],
                    metadata: {}
                }
            ],
            defaultFilePatterns: ['src/**/*.ts']
        };

        const researchTemplate: TaskTemplate = {
            id: 'research',
            name: 'Research Task',
            description: 'Standard workflow for research and investigation',
            baseTask: {
                title: '${topic}: Research',
                description: 'Research and investigate: ${topic}',
                priority: 'medium',
                tags: ['research'],
                blocks: [],
                blockedBy: [],
                fileReferences: [],
                taskReferences: [],
                urlReferences: [],
                metadata: {}
            },
            parameters: [
                { name: 'topic', description: 'Topic to research', required: true }
            ],
            subTasks: [
                {
                    title: 'Gather sources for ${topic}',
                    description: 'Collect relevant documentation, code, and resources',
                    status: 'pending',
                    priority: 'high',
                    tags: ['gathering'],
                    blocks: [],
                    blockedBy: [],
                    fileReferences: [],
                    taskReferences: [],
                    urlReferences: [],
                    metadata: {}
                },
                {
                    title: 'Analyze findings',
                    description: 'Analyze the gathered information and extract key insights',
                    status: 'pending',
                    priority: 'high',
                    tags: ['analysis'],
                    blocks: [],
                    blockedBy: [],
                    fileReferences: [],
                    taskReferences: [],
                    urlReferences: [],
                    metadata: {}
                },
                {
                    title: 'Document findings',
                    description: 'Create comprehensive documentation of findings and conclusions',
                    status: 'pending',
                    priority: 'medium',
                    tags: ['documentation'],
                    blocks: [],
                    blockedBy: [],
                    fileReferences: [],
                    taskReferences: [],
                    urlReferences: [],
                    metadata: {}
                }
            ],
            defaultFilePatterns: []
        };

        this.templates.set(featureDevTemplate.id, featureDevTemplate);
        this.templates.set(bugfixTemplate.id, bugfixTemplate);
        this.templates.set(researchTemplate.id, researchTemplate);
    }

    /** Retrieves the full current state object */
    getState(): AgentState {
        return this.state;
    }

    /** Partially updates the internal state */
    setState(state: Partial<AgentState>): void {
        this.state = { ...this.state, ...state };
    }

    // Todo operations

    /** Adds a new todo item to the list */
    async addTodo(todo: TodoItem): Promise<void> {
        this.state.todos.push(todo);
    }

    /** Updates properties of an existing todo item by ID */
    async updateTodo(id: string, updates: Partial<TodoItem>): Promise<void> {
        const todo = this.state.todos.find(t => t.id === id);
        if (todo) {
            Object.assign(todo, updates);
        }
    }

    /** Returns all current todos */
    async getTodos(): Promise<TodoItem[]> {
        return this.state.todos;
    }

    /** Returns all pending (not completed) todos */
    async getPendingTodos(): Promise<TodoItem[]> {
        return this.state.todos.filter(t => t.status !== 'completed');
    }

    /** Returns the first pending todo, or null if none */
    async getFirstPendingTodo(): Promise<TodoItem | null> {
        return this.state.todos.find(t => t.status === 'pending' || t.status === 'in_progress') || null;
    }

    /** Returns true if there are any pending todos */
    async hasPendingTodos(): Promise<boolean> {
        return this.state.todos.some(t => t.status !== 'completed');
    }

    /** Clears all todos (for fresh task starts) */
    async clearTodos(): Promise<void> {
        this.state.todos = [];
    }

    // Task operations

    /** Adds a new task to the list */
    async addTask(task: TaskItem): Promise<void> {
        this.state.tasks.push(task);
    }

    /** Adds multiple tasks to the list */
    async addTasks(tasks: TaskItem[]): Promise<void> {
        this.state.tasks.push(...tasks);
    }

    /** Updates properties of an existing task by ID */
    async updateTask(id: string, updates: Partial<Omit<TaskItem, 'id' | 'createdAt'>>): Promise<void> {
        const task = this.state.tasks.find(t => t.id === id);
        if (!task) return;

        const updated: TaskItem = {
            ...task,
            ...updates,
            id: task.id,
            createdAt: task.createdAt,
            updatedAt: new Date().toISOString(),
        };

        // If status changed to completed, set completedAt
        if (updates.status === 'completed' && task.status !== 'completed') {
            updated.completedAt = new Date().toISOString();
        }

        // If status changed from completed to something else, clear completedAt
        if (updates.status && updates.status !== 'completed' && task.status === 'completed') {
            updated.completedAt = undefined;
        }

        Object.assign(task, updated);

        // Auto-unblock dependent tasks when completing
        if (updated.status === 'completed' && task.status !== 'completed') {
            await this.unblockDependentTasks(id);
        }

        // Re-block dependent tasks if un-completing
        if (updates.status && updates.status !== 'completed' && task.status === 'completed') {
            await this.reblockDependentTasks(id);
        }
    }

    /** Returns a single task by ID */
    async getTask(id: string): Promise<TaskItem | null> {
        return this.state.tasks.find(t => t.id === id) || null;
    }

    /** Returns all current tasks */
    async getTasks(): Promise<TaskItem[]> {
        return this.state.tasks;
    }

    /** Returns tasks by IDs */
    async getTasksByIds(ids: string[]): Promise<TaskItem[]> {
        return this.state.tasks.filter(t => ids.includes(t.id));
    }

    /** Returns blocked tasks (status = 'blocked') */
    async getBlockedTasks(): Promise<TaskItem[]> {
        return this.state.tasks.filter(t => t.status === 'blocked');
    }

    /** Returns pending tasks (status != 'completed') */
    async getPendingTasks(): Promise<TaskItem[]> {
        return this.state.tasks.filter(t => t.status !== 'completed');
    }

    /** Returns available tasks (can be started - not blocked and not completed) */
    async getAvailableTasks(): Promise<TaskItem[]> {
        const tasks = this.state.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
        const completedIds = new Set(this.state.tasks.filter(t => t.status === 'completed').map(t => t.id));

        return tasks.filter(task => {
            return task.blockedBy.every(depId => completedIds.has(depId));
        });
    }

    /** Deletes a task with optional cascade */
    async deleteTask(id: string, cascade: boolean = false): Promise<void> {
        if (cascade) {
            // Delete tasks that are only blocked by this task
            const toDelete = [id];
            for (const task of this.state.tasks) {
                if (task.blockedBy.length === 1 && task.blockedBy[0] === id) {
                    toDelete.push(task.id);
                }
            }
            this.state.tasks = this.state.tasks.filter(t => !toDelete.includes(t.id));
        } else {
            this.state.tasks = this.state.tasks.filter(t => t.id !== id);

            // Remove this task from blockedBy of other tasks
            for (const task of this.state.tasks) {
                if (task.blockedBy.includes(id)) {
                    task.blockedBy = task.blockedBy.filter(b => b !== id);
                }
            }
        }
    }

    /** Clears all tasks */
    async clearTasks(): Promise<void> {
        this.state.tasks = [];
    }

    /** Unblock dependent tasks when a task completes */
    private async unblockDependentTasks(completedTaskId: string): Promise<void> {
        const completedIds = new Set(this.state.tasks.filter(t => t.status === 'completed').map(t => t.id));

        for (const task of this.state.tasks) {
            if (task.blockedBy.includes(completedTaskId) && task.status === 'blocked') {
                // Check if all dependencies are now complete
                const allDepsComplete = task.blockedBy.every(depId => completedIds.has(depId));
                if (allDepsComplete && task.blockedBy.length > 0) {
                    task.status = 'pending';
                }
            }
        }
    }

    /** Re-block dependent tasks when a task is un-completed */
    private async reblockDependentTasks(uncompletedTaskId: string): Promise<void> {
        for (const task of this.state.tasks) {
            if (task.blockedBy.includes(uncompletedTaskId) && task.status !== 'blocked') {
                task.status = 'blocked';
            }
        }
    }

    /** Derive execution order using topological sort with level detection */
    async getExecutionOrder(): Promise<ExecutionLevel[]> {
        const pendingTasks = this.state.tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
        const completedIds = new Set(this.state.tasks.filter(t => t.status === 'completed').map(t => t.id));

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

    /** Save a task template */
    async saveTemplate(template: TaskTemplate): Promise<void> {
        this.templates.set(template.id, template);
    }

    /** Get a template by ID */
    async getTemplate(id: string): Promise<TaskTemplate | null> {
        return this.templates.get(id) || null;
    }

    /** List all templates */
    async listTemplates(): Promise<TaskTemplate[]> {
        return Array.from(this.templates.values());
    }

    /** Delete a template (only custom templates, not built-in) */
    async deleteTemplate(id: string): Promise<void> {
        const builtInIds = ['feature_dev', 'bugfix', 'research'];
        if (builtInIds.includes(id)) {
            throw new Error('Cannot delete built-in templates');
        }
        this.templates.delete(id);
    }

    /** Apply a template with parameter substitution */
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
                    blockedBy: [lastSubTaskId],
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
}