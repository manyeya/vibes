import {
    tool,
    type UIMessageStreamWriter,
    generateText,
    type LanguageModel,
} from 'ai';
import { z } from 'zod';

import {
    AgentUIMessage,
    Middleware,
    TaskItem,
    createDataStreamWriter,
    type DataStreamWriter,
} from '../core/types';

/**
 * Middleware that provides task management with dependencies.
 * Tasks are created by an LLM to break down work into specific, actionable steps.
 */
export default class TasksMiddleware implements Middleware {
    name = 'TasksMiddleware';
    protected writer?: DataStreamWriter;
    private tasks: TaskItem[] = [];
    private tasksPath: string;

    constructor(
        protected model?: LanguageModel,
        config: { tasksPath?: string } = {}
    ) {
        this.tasksPath = config.tasksPath || 'workspace/tasks.json';
    }

    onStreamReady(writer: UIMessageStreamWriter<AgentUIMessage>) {
        this.writer = createDataStreamWriter(writer);
    }

    get tools() {
        return {
            create_tasks: tool({
                description: `Create tasks manually. For AI-generated tasks, use generate_tasks instead.`,
                inputSchema: z.object({
                    tasks: z.array(z.object({
                        title: z.string().describe('Short, specific task title'),
                        description: z.string().describe('Detailed description of what to do'),
                        status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional(),
                        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
                        blockedBy: z.array(z.string()).optional().describe('Task IDs this task depends on'),
                        fileReferences: z.array(z.string()).optional().describe('Relevant file paths'),
                        tags: z.array(z.string()).optional(),
                    })),
                }),
                execute: async ({ tasks }) => {
                    const now = new Date().toISOString();
                    const createdTasks: TaskItem[] = [];
                    const taskIds = new Map<string, string>();

                    // Generate task IDs
                    tasks.forEach((_task, index) => {
                        taskIds.set(index.toString(), `task_${Date.now()}_${index}`);
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

                        const newTask: TaskItem = {
                            id,
                            title: taskDef.title,
                            description: taskDef.description,
                            status: taskDef.status || 'pending',
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
                    await this.persistTasks();

                    return {
                        success: true,
                        message: `Created ${createdTasks.length} tasks`,
                        tasks: createdTasks,
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
                        return {
                            success: false,
                            error: 'No model available for task generation',
                        };
                    }

                    // Use LLM to generate specific, actionable tasks
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
                        return {
                            success: false,
                            error: `Failed to parse task generation: ${e}. Response was: ${text.slice(0, 200)}`,
                        };
                    }

                    // Create the tasks using create_tasks logic
                    const now = new Date().toISOString();
                    const createdTasks: TaskItem[] = [];

                    for (let i = 0; i < tasksData.tasks.length; i++) {
                        const taskDef = tasksData.tasks[i];
                        const id = `task_${Date.now()}_${i}`;

                        // Handle dependencies (previous tasks)
                        const blockedBy = i > 0 ? [`task_${Date.now()}_${i - 1}`] : [];

                        const newTask: TaskItem = {
                            id,
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
                    await this.persistTasks();

                    return {
                        success: true,
                        message: `Generated ${createdTasks.length} tasks`,
                        tasks: createdTasks,
                    };
                },
            }),

            update_task: tool({
                description: `Update task status or properties. Use this to mark tasks in_progress or completed.`,
                inputSchema: z.object({
                    id: z.string(),
                    status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional(),
                    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
                    description: z.string().optional(),
                    error: z.string().optional(),
                    addFileReferences: z.array(z.string()).optional(),
                }),
                execute: async (input) => {
                    const current = this.tasks.find(t => t.id === input.id);
                    if (!current) {
                        return { success: false, error: 'Task not found' };
                    }

                    const updates: Partial<TaskItem> = {};
                    if (input.status !== undefined) updates.status = input.status;
                    if (input.priority !== undefined) updates.priority = input.priority;
                    if (input.description !== undefined) updates.description = input.description;
                    if (input.error !== undefined) updates.error = input.error;
                    if (input.addFileReferences) {
                        updates.fileReferences = [...new Set([...current.fileReferences, ...input.addFileReferences])];
                    }

                    await this.updateTask(input.id, updates);
                    await this.persistTasks();

                    this.writer?.writeTaskUpdate(
                        input.id,
                        input.status || current.status,
                        current.title
                    );

                    return { success: true, message: `Task ${input.id} updated` };
                },
            }),

            get_next_tasks: tool({
                description: `Get the next task to work on. Returns pending tasks that aren't blocked.`,
                inputSchema: z.object({}),
                execute: async () => {
                    const availableTasks = await this.getAvailableTasks();
                    return {
                        success: true,
                        tasks: availableTasks,
                        count: availableTasks.length,
                    };
                },
            }),

            list_tasks: tool({
                description: `List all tasks with their current status.`,
                inputSchema: z.object({}),
                execute: async () => {
                    return {
                        success: true,
                        tasks: this.tasks,
                        count: this.tasks.length,
                    };
                },
            }),

            clear_tasks: tool({
                description: `Clear all tasks. Requires confirm=true.`,
                inputSchema: z.object({
                    confirm: z.boolean(),
                }),
                execute: async ({ confirm }) => {
                    if (!confirm) {
                        return { success: false, error: 'Must set confirm=true' };
                    }
                    this.tasks = [];
                    await this.persistTasks();
                    return { success: true, message: 'All tasks cleared' };
                },
            }),
        };
    }

    // Task management internal methods

    async addTask(task: TaskItem): Promise<void> {
        this.tasks.push(task);
    }

    async updateTask(id: string, updates: Partial<TaskItem>): Promise<void> {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index === -1) return;

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
        if (updated.status === 'completed' && current.status !== 'completed') {
            await this.unblockDependentTasks(id);
        }
    }

    async unblockDependentTasks(completedTaskId: string): Promise<void> {
        const completedIds = new Set(this.tasks.filter(t => t.status === 'completed').map(t => t.id));

        for (const task of this.tasks) {
            if (task.blockedBy.includes(completedTaskId) && task.status === 'blocked') {
                const allDepsComplete = task.blockedBy.every(depId => completedIds.has(depId));
                if (allDepsComplete) {
                    task.status = 'pending';
                    task.updatedAt = new Date().toISOString();
                }
            }
        }
    }

    async getAvailableTasks(): Promise<TaskItem[]> {
        const completedIds = new Set(this.tasks.filter(t => t.status === 'completed').map(t => t.id));
        return this.tasks.filter(task => {
            if (task.status === 'completed' || task.status === 'failed') return false;
            return task.blockedBy.every(depId => completedIds.has(depId));
        });
    }

    async getTasks(): Promise<TaskItem[]> {
        return [...this.tasks];
    }

    private async persistTasks(): Promise<void> {
        try {
            const fs = await import('fs/promises');
            const pathModule = await import('path');
            const fullPath = pathModule.resolve(process.cwd(), this.tasksPath);

            await fs.mkdir(pathModule.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, JSON.stringify(this.tasks, null, 2));
        } catch (e) {
            console.error('Failed to persist tasks:', e);
        }
    }

    private async loadTasks(): Promise<void> {
        try {
            const fs = await import('fs/promises');
            const pathModule = await import('path');
            const fullPath = pathModule.resolve(process.cwd(), this.tasksPath);

            const content = await fs.readFile(fullPath, 'utf-8');
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
5. Mark the task \`completed\` with \`update_task\`
6. Move to the next task

IMPORTANT: Tasks must be SPECIFIC - include actual file paths and specific changes.
DO NOT create generic tasks like "analyze requirements" or "implement logic".
`;
    }

    async onStreamFinish(): Promise<void> {
        // Tasks are managed explicitly by the agent
    }
}
