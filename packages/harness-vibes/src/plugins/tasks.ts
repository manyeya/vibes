import {
    tool,
    type UIMessageStreamWriter,
    generateText,
    type LanguageModel,
} from 'ai';
import { z } from 'zod';

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
            heartbeatMessage: `${toolName} is still working`,
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
                    tasks: z.array(z.object({
                        title: z.string().describe('Short, specific task title'),
                        description: z.string().describe('Detailed description of what to do'),
                        status: z.enum(TASK_STATUS_VALUES).optional(),
                        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
                        blockedBy: z.array(z.string()).optional().describe('Task IDs this task depends on'),
                        fileReferences: z.array(z.string()).optional().describe('Relevant file paths'),
                        tags: z.array(z.string()).optional(),
                    })),
                }),
                execute: async ({ tasks }) => {
                    const operation = this.createOperation('create-tasks', 'create_tasks');
                    const now = new Date().toISOString();
                    const createdTasks: TaskItem[] = [];
                    const batchId = createTaskBatchId();
                    const taskIds = new Map<string, string>();

                    operation?.milestone(`Creating ${tasks.length} task${tasks.length === 1 ? '' : 's'}`, {
                        phase: 'prepare',
                    });

                    // Generate task IDs
                    tasks.forEach((_task, index) => {
                        taskIds.set(index.toString(), `${batchId}_${index}`);
                    });

                    // Create tasks with proper IDs
                    for (let i = 0; i < tasks.length; i++) {
                        const taskDef = tasks[i];
                        const id = taskIds.get(i.toString())!;

                        // Resolve index-based blockedBy references
                        const resolvedBlockedBy = (taskDef.blockedBy || []).map(ref => {
                            if (/^\d+$/.test(ref)) {
                                return taskIds.get(ref) || ref;
                            }
                            return ref;
                        });

                        const status = taskDef.status || (resolvedBlockedBy.length > 0 ? 'blocked' : 'pending');

                        const newTask: TaskItem = {
                            id,
                            type: TaskType.SubTask,
                            title: taskDef.title,
                            description: taskDef.description,
                            status,
                            priority: taskDef.priority || 'medium',
                            createdAt: now,
                            updatedAt: now,
                            blocks: [],
                            blockedBy: resolvedBlockedBy,
                            fileReferences: taskDef.fileReferences || [],
                            taskReferences: [],
                            urlReferences: [],
                            metadata: {},
                            tags: taskDef.tags || [],
                        };

                        // Set inverse references
                        for (const depId of resolvedBlockedBy) {
                            const depTask = createdTasks.find(t => t.id === depId);
                            if (depTask) {
                                depTask.blocks.push(id);
                            }
                        }

                        createdTasks.push(newTask);
                        await this.addTask(newTask);

                        this.writer?.writeTaskUpdate(newTask.id, newTask.status, newTask.title);
                    }

                    operation?.milestone(`Persisting ${createdTasks.length} task${createdTasks.length === 1 ? '' : 's'}`, {
                        phase: 'persist',
                    });
                    await this.persistTasks();
                    this.emitTaskGraph();
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
                    operation?.milestone('Generating task breakdown', { phase: 'prepare' });

                    // Use LLM to generate specific, actionable tasks
                    operation?.milestone('Calling language model for task breakdown', { phase: 'model' });
                    const { text } = await generateText({
                        model: this.model,
                        system: `You are a task planner. Break down requests into specific, actionable tasks.

RULES:
1. Create 3-8 tasks maximum
2. Each task must be SPECIFIC and ACTIONABLE
3. Include actual file paths when relevant
4. Tasks should be sequential (later tasks depend on earlier ones)
5. DO NOT create generic tasks like "analyze requirements" or "implement logic"
6. Focus on WHAT files to change and WHAT changes to make

Output ONLY valid JSON, no markdown:
\`\`\`
{
  "tasks": [
    {
      "title": "Read and understand X file",
      "description": "Read path/to/file.ts to understand current implementation",
      "fileReferences": ["path/to/file.ts"],
      "priority": "high"
    },
    {
      "title": "Modify Y function to do Z",
      "description": "In path/to/file.ts, update the foo() function to add bar() logic",
      "fileReferences": ["path/to/file.ts"],
      "priority": "high"
    }
  ]
}
\`\`\``,
                        prompt: `Break down this request into specific, actionable tasks:\n\n${request}`,
                    });

                    // Parse JSON response
                    let tasksData: { tasks: any[] };
                    try {
                        // Extract JSON from response (handle markdown wrapping)
                        const jsonMatch = text.match(/```json\s*(\{[\s\S]*\})\s*```/) ||
                            text.match(/```\s*(\{[\s\S]*\})\s*```/) ||
                            text.match(/(\{[\s\S]*\})/);
                        if (!jsonMatch) {
                            throw new Error('No JSON found in response');
                        }
                        tasksData = JSON.parse(jsonMatch[1]);
                    } catch (e) {
                        this.writer?.writeError(`Failed to parse task generation: ${e}`, {
                            toolName: 'generate_tasks',
                            recoverable: true,
                            context: text.slice(0, 200),
                        });
                        return {
                            success: false,
                            error: `Failed to parse task generation: ${e}. Response was: ${text.slice(0, 200)}`,
                        };
                    }

                    // Create the tasks using create_tasks logic
                    const now = new Date().toISOString();
                    const createdTasks: TaskItem[] = [];
                    const batchId = createTaskBatchId();
                    const taskIds = tasksData.tasks.map((_, i) => `${batchId}_${i}`);
                    operation?.milestone(`Parsed ${tasksData.tasks.length} generated task${tasksData.tasks.length === 1 ? '' : 's'}`, {
                        phase: 'parse',
                    });

                    for (let i = 0; i < tasksData.tasks.length; i++) {
                        const taskDef = tasksData.tasks[i];
                        const id = taskIds[i];

                        // Handle dependencies (previous tasks)
                        const blockedBy = i > 0 ? [taskIds[i - 1]] : [];

                        const newTask: TaskItem = {
                            id,
                            type: TaskType.SubTask,
                            title: taskDef.title,
                            description: taskDef.description,
                            status: i === 0 ? 'pending' : 'blocked',
                            priority: taskDef.priority || 'medium',
                            createdAt: now,
                            updatedAt: now,
                            blocks: [],
                            blockedBy,
                            fileReferences: taskDef.fileReferences || [],
                            taskReferences: [],
                            urlReferences: [],
                            metadata: {},
                            tags: taskDef.tags || [],
                        };

                        // Update previous task's blocks
                        if (i > 0 && createdTasks[i - 1]) {
                            createdTasks[i - 1].blocks.push(id);
                        }

                        createdTasks.push(newTask);
                        await this.addTask(newTask);

                        this.writer?.writeTaskUpdate(newTask.id, newTask.status, newTask.title);
                    }

                    operation?.milestone(`Persisting ${createdTasks.length} generated task${createdTasks.length === 1 ? '' : 's'}`, {
                        phase: 'persist',
                    });
                    await this.persistTasks();
                    this.emitTaskGraph();
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
                    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
                    description: z.string().optional(),
                    error: z.string().optional(),
                    addFileReferences: z.array(z.string()).optional(),
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
            const fullPath = require('path').resolve(process.cwd(), this.tasksPath);
            Bun.spawnSync(['mkdir', '-p', require('path').dirname(fullPath)]);
            await Bun.write(fullPath, JSON.stringify(this.tasks, null, 2));
        } catch (e) {
            console.error('Failed to persist tasks:', e);
        }
    }

    private async loadTasks(): Promise<void> {
        try {
            const fullPath = require('path').resolve(process.cwd(), this.tasksPath);
            const content = await Bun.file(fullPath).text();
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

## Task Workflow

When working on complex requests:
1. Use \`generate_tasks\` to break down the work into specific, actionable tasks
2. Use \`get_next_tasks\` to see what to work on
3. Pick a task, mark it \`in_progress\` with \`update_task\`
4. DO the work (read files, make changes)
5. Mark the task \`completed\` with \`update_task\` only after the work is actually done
6. Continue until \`update_task\` returns \`allDone: true\`

IMPORTANT: Tasks must be SPECIFIC - include actual file paths and specific changes.
DO NOT create generic tasks like "analyze requirements" or "implement logic".
If a task is \`in_progress\`, continue that task before starting a new one.
`;
    }

    async onStreamFinish(): Promise<void> {
        // Tasks are managed explicitly by the agent
    }
}
