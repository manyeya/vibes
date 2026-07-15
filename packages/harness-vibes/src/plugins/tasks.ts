import {
    tool,
    type UIMessageStreamWriter,
    generateObject,
    type LanguageModel,
} from 'ai';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';

import {
    VibesUIMessage,
    Plugin,
    PluginStreamContext,
    TaskItem,
    TaskType,
    createDataStreamWriter,
    type DataStreamWriter,
} from '../core/types';

type TaskStatus = TaskItem['status'];

const TASK_STATUS_VALUES = ['pending', 'blocked', 'in_progress', 'completed', 'failed'] as const;
const PRIORITY_VALUES = ['low', 'medium', 'high', 'critical'] as const;

/**
 * A single task as supplied to create_tasks or produced by generate_tasks.
 * `blockedBy` references other tasks IN THE SAME BATCH by their 0-based index,
 * which {@link TasksPlugin.createTasksFromDefs} resolves to real ids — so a batch
 * can describe an arbitrary dependency DAG, not just a linear chain.
 */
const taskDefSchema = z.object({
    title: z.string().describe('Short, specific task title'),
    description: z.string().describe('Detailed description of what to do'),
    status: z.enum(TASK_STATUS_VALUES).optional(),
    priority: z.enum(PRIORITY_VALUES).optional(),
    blockedBy: z.array(z.union([z.string(), z.number()])).optional()
        .describe('Tasks this one depends on, by their 0-based index in this list (e.g. [0, 1]). Omit for an independent/parallel task.'),
    fileReferences: z.array(z.string()).optional().describe('Relevant file paths'),
    tags: z.array(z.string()).optional(),
});
type TaskDef = z.infer<typeof taskDefSchema>;

/** Structured-output schema for generate_tasks. */
const generatedTasksSchema = z.object({
    tasks: z.array(taskDefSchema).min(1).max(12),
});

function createTaskBatchId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function summarizeTask(task: TaskItem) {
    return {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        blockedBy: task.blockedBy,
        fileReferences: task.fileReferences,
    };
}

/**
 * Plugin that provides task management with dependencies.
 * Tasks are created by an LLM to break down work into specific, actionable steps.
 */
export default class TasksPlugin implements Plugin {
    name = 'TasksPlugin';
    protected writer?: DataStreamWriter;
    protected streamContext?: PluginStreamContext;
    private tasks: TaskItem[] = [];
    private tasksPath: string;

    constructor(
        protected model?: LanguageModel,
        config: { tasksPath?: string } = {}
    ) {
        this.tasksPath = config.tasksPath || 'workspace/tasks.json';
    }

    onStreamContextReady(context: PluginStreamContext) {
        this.streamContext = context;
        this.writer = context.writer.withDefaults({ plugin: this.name });
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.streamContext = undefined;
        this.writer = createDataStreamWriter(writer).withDefaults({ plugin: this.name });
    }

    protected createOperation(name: string, toolName: string) {
        return this.streamContext?.createOperation({
            name,
            toolName,
            plugin: this.name,
        });
    }

    protected emitTaskGraph(): void {
        this.writer?.writeTaskGraph(
            this.tasks.map(task => ({
                id: task.id,
                title: task.title,
                status: task.status,
                priority: task.priority,
            })),
            this.tasks.flatMap(task => [
                ...task.blockedBy.map(depId => ({
                    from: depId,
                    to: task.id,
                    type: 'blocks' as const,
                })),
                ...task.taskReferences.map(refId => ({
                    from: task.id,
                    to: refId,
                    type: 'related' as const,
                })),
            ])
        );
    }

    streamTaskGraph(): void {
        this.emitTaskGraph();
    }

    get tools(): Record<string, import("ai").Tool> {
        return {
            create_tasks: tool({
                description: `Create tasks manually. For AI-generated tasks, use generate_tasks instead.`,
                inputSchema: z.object({
                    tasks: z.array(taskDefSchema),
                }),
                execute: async ({ tasks }) => {
                    const operation = this.createOperation('create-tasks', 'create_tasks');
                    operation?.milestone(`Creating ${tasks.length} task${tasks.length === 1 ? '' : 's'}`, {
                        phase: 'prepare',
                    });

                    const createdTasks = await this.createTasksFromDefs(tasks);

                    operation?.complete(`Created ${createdTasks.length} task${createdTasks.length === 1 ? '' : 's'}`, {
                        phase: 'complete',
                    });

                    return {
                        success: true,
                        message: `Created ${createdTasks.length} tasks`,
                        tasks: createdTasks.map(summarizeTask),
                        nextTasks: (await this.getAvailableTasks()).map(summarizeTask),
                    };
                },
            }),

            generate_tasks: tool({
                description: `Break down a complex request into specific, actionable tasks.

Use this when:
- The request involves multiple steps or files
- Work can be broken down into clear, sequential actions

The LLM will analyze the request and create specific tasks tied to actual files/changes.`,
                inputSchema: z.object({
                    request: z.string().describe('The user request to break down into tasks'),
                }),
                execute: async ({ request }) => {
                    if (!this.model) {
                        this.writer?.writeError('No model available for task generation', {
                            toolName: 'generate_tasks',
                            recoverable: true,
                        });
                        return {
                            success: false,
                            error: 'No model available for task generation',
                        };
                    }

                    const operation = this.createOperation('generate-tasks', 'generate_tasks');
                    operation?.milestone('Calling language model for task breakdown', { phase: 'model' });

                    // Structured output: the model returns the task list directly,
                    // schema-validated — no brittle JSON-from-prose extraction.
                    let taskDefs: TaskDef[];
                    try {
                        const { object } = await generateObject({
                            model: this.model,
                            schema: generatedTasksSchema,
                            // generateObject doesn't take `timeout`; an abort signal is
                            // the anti-hang ceiling for a stalled/misbehaving model.
                            abortSignal: AbortSignal.timeout(300_000),
                            system: `You are a task planner. Break down requests into specific, actionable tasks.

RULES:
1. Create 3-8 tasks maximum
2. Each task must be SPECIFIC and ACTIONABLE
3. Include actual file paths when relevant
4. Express dependencies with each task's \`blockedBy\` = the 0-based indices of the tasks that must finish first (e.g. a task depending on the first task uses [0]). Tasks that can run in parallel have no blockedBy.
5. DO NOT create generic tasks like "analyze requirements" or "implement logic"
6. Focus on WHAT files to change and WHAT changes to make`,
                            prompt: `Break down this request into specific, actionable tasks:\n\n${request}`,
                        });
                        taskDefs = object.tasks;
                    } catch (e) {
                        this.writer?.writeError(`Failed to generate tasks: ${e}`, {
                            toolName: 'generate_tasks',
                            recoverable: true,
                        });
                        return {
                            success: false,
                            error: `Failed to generate tasks: ${e}`,
                        };
                    }

                    operation?.milestone(`Creating ${taskDefs.length} generated task${taskDefs.length === 1 ? '' : 's'}`, {
                        phase: 'persist',
                    });
                    const createdTasks = await this.createTasksFromDefs(taskDefs);
                    operation?.complete(`Generated ${createdTasks.length} task${createdTasks.length === 1 ? '' : 's'}`, {
                        phase: 'complete',
                    });

                    return {
                        success: true,
                        message: `Generated ${createdTasks.length} tasks`,
                        tasks: createdTasks.map(summarizeTask),
                        nextTasks: (await this.getAvailableTasks()).map(summarizeTask),
                    };
                },
            }),

            update_task: tool({
                description: `Update task status or properties. Use this to mark tasks in_progress or completed.`,
                inputSchema: z.object({
                    id: z.string(),
                    status: z.enum(TASK_STATUS_VALUES).optional(),
                    priority: z.enum(PRIORITY_VALUES).optional(),
                    description: z.string().optional(),
                    error: z.string().optional(),
                    addFileReferences: z.array(z.string()).optional(),
                    blockedBy: z.array(z.string()).optional()
                        .describe('Replace this task\'s dependencies (existing task IDs). Inverse edges are maintained and blocked/pending status is recomputed.'),
                }),
                execute: async (input) => {
                    const operation = this.createOperation('update-task', 'update_task');
                    const current = this.tasks.find(t => t.id === input.id);
                    if (!current) {
                        this.writer?.writeError(`Task not found: ${input.id}`, {
                            toolName: 'update_task',
                            recoverable: true,
                        });
                        return { success: false, error: 'Task not found' };
                    }

                    operation?.milestone(`Updating task ${current.title}`, { phase: 'update' });

                    const updates: Partial<TaskItem> = {};
                    if (input.status !== undefined) updates.status = input.status;
                    if (input.priority !== undefined) updates.priority = input.priority;
                    if (input.description !== undefined) updates.description = input.description;
                    if (input.error !== undefined) updates.error = input.error;
                    if (input.addFileReferences) {
                        updates.fileReferences = [...new Set([...current.fileReferences, ...input.addFileReferences])];
                    }
                    if (input.blockedBy !== undefined) {
                        // Re-wire dependencies: maintain the inverse `blocks` edges on
                        // the dependency tasks, then recompute this task's blocked/
                        // pending status from the new deps.
                        const oldDeps = new Set(current.blockedBy);
                        const newDeps = new Set(input.blockedBy.filter(depId => depId !== current.id));
                        for (const depId of oldDeps) {
                            if (newDeps.has(depId)) continue;
                            const dep = this.tasks.find(t => t.id === depId);
                            if (dep) dep.blocks = dep.blocks.filter(b => b !== current.id);
                        }
                        for (const depId of newDeps) {
                            if (oldDeps.has(depId)) continue;
                            const dep = this.tasks.find(t => t.id === depId);
                            if (dep && !dep.blocks.includes(current.id)) dep.blocks.push(current.id);
                        }
                        updates.blockedBy = [...newDeps];
                        // Recompute status unless explicitly set or the task is already
                        // terminal / in-progress.
                        if (input.status === undefined &&
                            current.status !== 'completed' && current.status !== 'failed' && current.status !== 'in_progress') {
                            const completedIds = new Set(this.tasks.filter(t => t.status === 'completed').map(t => t.id));
                            const stillBlocked = updates.blockedBy.some(depId => !completedIds.has(depId));
                            updates.status = stillBlocked ? 'blocked' : 'pending';
                        }
                    }

                    const { task: updatedTask, unblocked } = await this.updateTask(input.id, updates);
                    await this.persistTasks();

                    this.writer?.writeTaskUpdate(input.id, updatedTask.status, updatedTask.title);
                    for (const task of unblocked) {
                        this.writer?.writeTaskUpdate(task.id, task.status, task.title);
                    }
                    this.emitTaskGraph();
                    operation?.complete(`Updated task ${current.title}`, { phase: 'complete' });

                    const nextTasks = await this.getAvailableTasks();
                    const activeTasks = this.tasks.filter(task => task.status === 'in_progress').map(summarizeTask);
                    const remainingTasks = this.tasks.filter(task => task.status !== 'completed' && task.status !== 'failed');
                    return {
                        success: true,
                        message: `Task ${input.id} updated to ${updatedTask.status}`,
                        task: summarizeTask(updatedTask),
                        unblocked: unblocked.map(summarizeTask),
                        currentTasks: activeTasks,
                        nextTasks: nextTasks.map(summarizeTask),
                        remainingCount: remainingTasks.length,
                        allDone: remainingTasks.length === 0,
                        guidance: remainingTasks.length === 0
                            ? 'All tracked tasks are complete. Finalize the user-facing answer.'
                            : activeTasks.length > 0
                                ? 'Continue the in-progress task and mark it completed when the work is actually done.'
                                : 'Pick one nextTasks item, mark it in_progress, do the work, then mark it completed.',
                    };
                },
            }),

            get_next_tasks: tool({
                description: `Get the current task to continue, or pending tasks that are not blocked.`,
                inputSchema: z.object({}),
                execute: async () => {
                    const availableTasks = await this.getAvailableTasks();
                    const currentTasks = availableTasks.filter(task => task.status === 'in_progress');
                    const nextTasks = availableTasks.filter(task => task.status === 'pending');
                    return {
                        success: true,
                        currentTasks: currentTasks.map(summarizeTask),
                        nextTasks: nextTasks.map(summarizeTask),
                        tasks: availableTasks.map(summarizeTask),
                        count: availableTasks.length,
                        guidance: currentTasks.length > 0
                            ? 'Continue the in-progress task before starting a new one.'
                            : nextTasks.length > 0
                                ? 'Pick one nextTasks item and mark it in_progress before doing the work.'
                                : 'No unblocked tasks are available. If blocked tasks remain, complete their dependencies first.',
                    };
                },
            }),

            list_tasks: tool({
                description: `List all tasks with their current status.`,
                inputSchema: z.object({}),
                execute: async () => {
                    return {
                        success: true,
                        tasks: this.tasks.map(summarizeTask),
                        count: this.tasks.length,
                        activeCount: this.tasks.filter(task => task.status !== 'completed' && task.status !== 'failed').length,
                    };
                },
            }),

            clear_tasks: tool({
                description: `Clear all tasks. Requires confirm=true.`,
                inputSchema: z.object({
                    confirm: z.boolean(),
                }),
                execute: async ({ confirm }) => {
                    const operation = this.createOperation('clear-tasks', 'clear_tasks');
                    if (!confirm) {
                        this.writer?.writeError('Must set confirm=true before clearing tasks', {
                            toolName: 'clear_tasks',
                            recoverable: true,
                        });
                        return { success: false, error: 'Must set confirm=true' };
                    }
                    operation?.milestone('Clearing all tasks', { phase: 'clear' });
                    this.tasks = [];
                    await this.persistTasks();
                    this.emitTaskGraph();
                    operation?.complete('Cleared all tasks', { phase: 'complete' });
                    return { success: true, message: 'All tasks cleared' };
                },
            }),
        };
    }

    // Task management internal methods

    /**
     * Create a batch of tasks from defs, resolving each def's index-based
     * `blockedBy` into the generated ids and wiring the inverse `blocks` edges.
     * Shared by create_tasks and generate_tasks so dependency handling (the DAG)
     * lives in one place. Persists + streams the graph; returns the new tasks.
     */
    private async createTasksFromDefs(taskDefs: TaskDef[]): Promise<TaskItem[]> {
        const now = new Date().toISOString();
        const batchId = createTaskBatchId();
        const created: TaskItem[] = [];
        const idByIndex = new Map<string, string>();
        taskDefs.forEach((_, i) => idByIndex.set(String(i), `${batchId}_${i}`));

        for (let i = 0; i < taskDefs.length; i++) {
            const def = taskDefs[i];
            const id = idByIndex.get(String(i))!;
            // A numeric ref is an index into this batch; anything else is passed
            // through (an already-existing task id).
            const resolvedBlockedBy = (def.blockedBy ?? []).map(ref => {
                const key = String(ref);
                return /^\d+$/.test(key) ? (idByIndex.get(key) ?? key) : key;
            });
            const status: TaskStatus = def.status ?? (resolvedBlockedBy.length > 0 ? 'blocked' : 'pending');

            const newTask: TaskItem = {
                id,
                type: TaskType.SubTask,
                title: def.title,
                description: def.description,
                status,
                priority: def.priority || 'medium',
                createdAt: now,
                updatedAt: now,
                blocks: [],
                blockedBy: resolvedBlockedBy,
                fileReferences: def.fileReferences || [],
                taskReferences: [],
                urlReferences: [],
                metadata: {},
                tags: def.tags || [],
            };

            // Inverse edges for already-created deps (backward references).
            for (const depId of resolvedBlockedBy) {
                const depTask = created.find(t => t.id === depId);
                if (depTask) depTask.blocks.push(id);
            }

            created.push(newTask);
            await this.addTask(newTask);
            this.writer?.writeTaskUpdate(newTask.id, newTask.status, newTask.title);
        }

        await this.persistTasks();
        this.emitTaskGraph();
        return created;
    }

    async addTask(task: TaskItem): Promise<void> {
        this.tasks.push(task);
    }

    async updateTask(id: string, updates: Partial<TaskItem>): Promise<{ task: TaskItem; unblocked: TaskItem[] }> {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index === -1) throw new Error(`Task not found: ${id}`);

        const current = this.tasks[index];
        const updated = {
            ...current,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        if (updates.status === 'completed' && current.status !== 'completed') {
            updated.completedAt = new Date().toISOString();
        }

        this.tasks[index] = updated;

        // Auto-unblock
        let unblocked: TaskItem[] = [];
        if (updated.status === 'completed' && current.status !== 'completed') {
            unblocked = await this.unblockDependentTasks(id);
        }

        return { task: updated, unblocked };
    }

    async unblockDependentTasks(completedTaskId: string): Promise<TaskItem[]> {
        const completedIds = new Set(this.tasks.filter(t => t.status === 'completed').map(t => t.id));
        const unblocked: TaskItem[] = [];

        for (const task of this.tasks) {
            if (task.blockedBy.includes(completedTaskId) && task.status === 'blocked') {
                const allDepsComplete = task.blockedBy.every(depId => completedIds.has(depId));
                if (allDepsComplete) {
                    task.status = 'pending';
                    task.updatedAt = new Date().toISOString();
                    unblocked.push(task);
                }
            }
        }

        return unblocked;
    }

    async getAvailableTasks(): Promise<TaskItem[]> {
        const completedIds = new Set(this.tasks.filter(t => t.status === 'completed').map(t => t.id));
        return this.tasks.filter(task => {
            if (task.status === 'completed' || task.status === 'failed') return false;
            if (task.status === 'blocked') return false;
            return task.blockedBy.every(depId => completedIds.has(depId));
        });
    }

    async getTasks(): Promise<TaskItem[]> {
        return [...this.tasks];
    }

    private async persistTasks(): Promise<void> {
        try {
            const fullPath = path.resolve(process.cwd(), this.tasksPath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            await fs.promises.writeFile(fullPath, JSON.stringify(this.tasks, null, 2));
        } catch (e) {
            console.error('Failed to persist tasks:', e);
        }
    }

    private async loadTasks(): Promise<void> {
        try {
            const fullPath = path.resolve(process.cwd(), this.tasksPath);
            const content = await fs.promises.readFile(fullPath, 'utf8');
            this.tasks = JSON.parse(content);
        } catch (e) {
            this.tasks = [];
        }
    }

    async waitReady(): Promise<void> {
        await this.loadTasks();
    }

    modifySystemPrompt(prompt: string): string | Promise<string> {
        return `${prompt}

## Tasks

Track multi-step work as explicit tasks.
- \`generate_tasks\` — create a quick checklist directly when a full plan would be overkill; for larger work prefer the planning workflow (\`create_plan\` → \`generate_tasks_from_plan\`) when available.
- \`update_task\` — mark a task \`in_progress\` before starting it and \`completed\` only when the work is actually done; continue until it returns \`allDone: true\`.
- \`get_next_tasks\` / \`list_tasks\` — stay focused; finish an \`in_progress\` task before starting another.

Tasks must be SPECIFIC — actual file paths and changes, not "analyze requirements".
`;
    }

    async onStreamFinish(): Promise<void> {
        // Tasks are managed explicitly by the agent
    }
}
