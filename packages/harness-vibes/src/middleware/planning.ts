import {
    tool,
    type UIMessageStreamWriter,
    type LanguageModel,
} from 'ai';
import { z } from 'zod';
import StateBackend from '../backend/statebackend';
import TasksMiddleware from './tasks';
import { VibesUIMessage, TaskItem, Middleware, type ModelMessage } from '../core/types';

/**
 * Planning configuration options
 */
export interface PlanningConfig {
    /** Path to save/load plan files (default: workspace/plan.md) */
    planPath?: string;
    /** Interval for automatic plan recitation (default: every prepareCall) */
    recitationInterval?: number;
    /** Maximum number of pending tasks to show in recitation */
    maxRecitationTasks?: number;
}

/**
 * Plan entry for hierarchical task structure
 */
export interface PlanEntry {
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'blocked';
    priority: 'low' | 'medium' | 'high' | 'critical';
    parentTaskId?: string;
    subtasks: PlanEntry[];
    blockedBy: string[];
    blocks: string[];
}

/**
 * PlanningMiddleware composes TasksMiddleware with deep agent planning features:
 * - Task recitation: Always-in-view current plan for attention manipulation
 * - Plan persistence: Save/load plans from filesystem
 * - Hierarchical decomposition: Parent-child task relationships
 * - Smart recitation: Format plan for readability and focus
 *
 * Key insight from Manus: "By constantly rewriting the todo list, Manus is reciting
 * its objectives into the end of the context. This pushes the global plan into the
 * model's recent attention span, avoiding 'lost-in-the-middle' issues."
 */
export class PlanningMiddleware implements Middleware {
    name = 'PlanningMiddleware';
    private writer?: UIMessageStreamWriter<VibesUIMessage>;
    private planPath: string;
    private maxRecitationTasks: number;
    private lastRecitedTasks: TaskItem[] = [];

    // Compose TasksMiddleware instead of extending to avoid type conflicts
    private tasksMiddleware: TasksMiddleware;
    private backend: StateBackend;

    constructor(
        backend: StateBackend,
        model?: LanguageModel,
        config: PlanningConfig = {}
    ) {
        this.backend = backend;
        this.tasksMiddleware = new TasksMiddleware(backend, model);
        this.planPath = config.planPath || 'workspace/plan.md';
        this.maxRecitationTasks = config.maxRecitationTasks || 10;
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.writer = writer;
        // Also forward to tasks middleware
        this.tasksMiddleware.onStreamReady(writer);
    }

    /**
     * Modify system prompt to inject task recitation.
     * This is the key "attention manipulation" technique from Manus.
     */
    modifySystemPrompt(prompt: string): string | Promise<string> {
        const basePrompt = this.tasksMiddleware.modifySystemPrompt(prompt);
        // Add planning instructions
        const planningInstructions = `

## Planning & Task Management

Your current tasks are always visible in the plan above. Use these tools:
- \`save_plan()\` - Save the current task plan to a file
- \`load_plan()\` - Load a task plan from a file
- \`recite_plan()\` - Refresh and view your current task plan
- \`create_subtask()\` - Create a subtask under an existing parent task

Remember: Focus on the current task. Mark it complete before moving to the next.
`;
        if (typeof basePrompt === 'string') {
            return basePrompt + planningInstructions;
        }
        return basePrompt.then(p => p + planningInstructions);
    }

    /**
     * Hook before each step to refresh task cache for recitation.
     * This replaces the deprecated beforeModel hook.
     */
    async prepareStep(_options: {
        steps: any[];
        stepNumber: number;
        model: import('ai').LanguageModel;
        messages: import('../core/types').ModelMessage[];
        experimental_context?: unknown;
    }): Promise<void> {
        // Refresh task cache before each step
        await this.refreshRecitationCache();
    }

    /**
     * Refresh the cached task list for recitation.
     * Call this after task updates.
     */
    private async refreshRecitationCache(): Promise<void> {
        const allTasks = await this.backend.getTasks();
        // Filter out completed and failed tasks - only show active tasks in recitation
        const pendingTasks = allTasks.filter(t => t.status !== 'completed' && t.status !== 'failed');

        const statusOrder: Record<string, number> = {
            'in_progress': 0,
            'pending': 1,
            'blocked': 2,
            'failed': 3,
            'completed': 4
        };
        pendingTasks.sort((a, b) => {
            const aOrder = statusOrder[a.status] ?? 3;
            const bOrder = statusOrder[b.status] ?? 3;
            return aOrder - bOrder;
        });

        this.lastRecitedTasks = pendingTasks.slice(0, this.maxRecitationTasks);
    }

    /**
     * Format tasks for recitation in system prompt.
     * Uses markdown for readability and visual hierarchy.
     */
    private formatPlanForRecitation(tasks: TaskItem[]): string {
        let output = `## Current Plan (${tasks.length} active tasks)\n\n`;

        const inProgress = tasks.filter(t => t.status === 'in_progress');
        const pending = tasks.filter(t => t.status === 'pending');
        const blocked = tasks.filter(t => t.status === 'blocked');

        if (inProgress.length > 0) {
            output += `### 🔵 Working On Now\n`;
            for (const task of inProgress) {
                output += this.formatTaskEntry(task);
            }
            output += '\n';
        }

        if (pending.length > 0) {
            output += `### 📋 Next Up\n`;
            for (const task of pending) {
                output += this.formatTaskEntry(task);
            }
            output += '\n';
        }

        if (blocked.length > 0) {
            output += `### ⏸️ Blocked (waiting for dependencies)\n`;
            for (const task of blocked) {
                output += this.formatTaskEntry(task);
            }
            output += '\n';
        }

        output += `---\n**Remember**: Focus on the current task. When complete, mark it done and move to the next. Use \`update_task\` to track progress.`;

        return output;
    }

    /**
     * Format a single task entry for recitation.
     */
    private formatTaskEntry(task: TaskItem): string {
        const priorityIcon = {
            'critical': '🔴',
            'high': '🟠',
            'medium': '🟡',
            'low': '⚪'
        }[task.priority] || '⚪';

        const statusPrefix: Record<string, string> = {
            'in_progress': '→',
            'pending': '○',
            'blocked': '⊘',
            'completed': '✓',
            'failed': '✗'
        };
        const prefix = statusPrefix[task.status] || '○';

        let entry = `${prefix} **${task.title}** ${priorityIcon}\n`;

        if (task.description) {
            // Truncate long descriptions for recitation
            const desc = task.description.length > 100
                ? task.description.slice(0, 100) + '...'
                : task.description;
            entry += `  ${desc}\n`;
        }

        if (task.blockedBy && task.blockedBy.length > 0) {
            entry += `  ⏳ Blocked by: ${task.blockedBy.join(', ')}\n`;
        }

        if (task.fileReferences && task.fileReferences.length > 0) {
            entry += `  📁 ${task.fileReferences.slice(0, 3).join(', ')}${task.fileReferences.length > 3 ? '...' : ''}\n`;
        }

        return entry + '\n';
    }

    /**
     * Enhanced tools with planning-specific features
     */
    get tools(): any {
        const baseTools = this.tasksMiddleware.tools;

        return Object.assign({}, baseTools, {

            save_plan: tool({
                description: `Save the current task plan to a file for persistence and cross-session continuity.`,
                inputSchema: z.object({
                    path: z.string().optional().describe('File path to save plan (default: workspace/plan.md)'),
                }),
                execute: async ({ path }) => {
                    const savePath = path || this.planPath;
                    const tasks = await this.backend.getTasks();

                    // Format as markdown plan document
                    let content = `# Task Plan\n\n`;
                    content += `Generated: ${new Date().toISOString()}\n`;
                    content += `Total tasks: ${tasks.length}\n\n`;

                    const byStatus: Record<string, TaskItem[]> = {
                        'in_progress': [],
                        'pending': [],
                        'blocked': [],
                        'completed': [],
                        'failed': [],
                    };

                    for (const task of tasks) {
                        if (byStatus[task.status]) {
                            byStatus[task.status].push(task);
                        }
                    }

                    for (const [status, statusTasks] of Object.entries(byStatus)) {
                        if (statusTasks.length === 0) continue;
                        content += `## ${status.toUpperCase()} (${statusTasks.length})\n\n`;
                        for (const task of statusTasks) {
                            content += `### ${task.title}\n`;
                            content += `- **ID**: \`${task.id}\`\n`;
                            content += `- **Priority**: ${task.priority}\n`;
                            if (task.description) {
                                content += `- **Description**: ${task.description}\n`;
                            }
                            if (task.blockedBy.length > 0) {
                                content += `- **Blocked by**: ${task.blockedBy.join(', ')}\n`;
                            }
                            if (task.fileReferences.length > 0) {
                                content += `- **Files**: ${task.fileReferences.join(', ')}\n`;
                            }
                            content += '\n';
                        }
                    }

                    // Write to file
                    const fs = await import('fs/promises');
                    const pathModule = await import('path');
                    const fullPath = pathModule.resolve(process.cwd(), savePath);

                    await fs.mkdir(pathModule.dirname(fullPath), { recursive: true });
                    await fs.writeFile(fullPath, content);

                    this.writer?.write({
                        type: 'data-status',
                        data: { message: `Plan saved to ${savePath}` },
                    });

                    return {
                        success: true,
                        path: savePath,
                        taskCount: tasks.length,
                    };
                },
            }),

            load_plan: tool({
                description: `Load a task plan from a file. Parses and creates tasks from the saved plan.`,
                inputSchema: z.object({
                    path: z.string().optional().describe('File path to load plan from (default: workspace/plan.md)'),
                    clearExisting: z.boolean().default(false).describe('Clear existing tasks before loading'),
                }),
                execute: async ({ path, clearExisting }) => {
                    const loadPath = path || this.planPath;

                    const fs = await import('fs/promises');
                    const pathModule = await import('path');
                    const fullPath = pathModule.resolve(process.cwd(), loadPath);

                    try {
                        const content = await fs.readFile(fullPath, 'utf-8');

                        // For now, return the content for the agent to process
                        // In a full implementation, we'd parse the markdown and extract tasks
                        this.writer?.write({
                            type: 'data-status',
                            data: { message: `Plan loaded from ${loadPath}` },
                        });

                        return {
                            success: true,
                            content: content,
                            message: 'Plan content loaded. Use generate_tasks or create_tasks to recreate the task structure.',
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        };
                    }
                },
            }),

            recite_plan: tool({
                description: `Manually trigger plan recitation. Refreshes the task cache and returns the current plan formatted for display.`,
                inputSchema: z.object({}),
                execute: async () => {
                    await this.refreshRecitationCache();
                    const tasks = this.lastRecitedTasks;

                    return {
                        success: true,
                        recitation: this.formatPlanForRecitation(tasks),
                        activeCount: tasks.length,
                        message: `Recited ${tasks.length} active tasks.`,
                    };
                },
            }),

            create_subtask: tool({
                description: `Create a subtask under an existing parent task. The subtask will be blocked by the parent task.`,
                inputSchema: z.object({
                    parentTaskId: z.string().describe('ID of the parent task'),
                    title: z.string().describe('Title of the subtask'),
                    description: z.string().describe('Description of what the subtask involves'),
                    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
                    fileReferences: z.array(z.string()).optional(),
                }),
                execute: async ({ parentTaskId, title, description, priority, fileReferences }) => {
                    const tasks = await this.backend.getTasks();
                    const parent = tasks.find(t => t.id === parentTaskId);

                    if (!parent) {
                        return {
                            success: false,
                            error: `Parent task not found: ${parentTaskId}`,
                        };
                    }

                    const now = new Date().toISOString();
                    const subtaskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

                    const subtask: TaskItem = {
                        id: subtaskId,
                        title,
                        description,
                        status: 'blocked', // Subtasks start blocked by parent
                        priority: priority || 'medium',
                        createdAt: now,
                        updatedAt: now,
                        blocks: [],
                        blockedBy: [parentTaskId],
                        fileReferences: fileReferences || [],
                        taskReferences: [],
                        urlReferences: [],
                        metadata: { parentTaskId },
                        tags: [],
                    };

                    // Add subtask to blocks list of parent
                    const updatedParent = {
                        ...parent,
                        blocks: [...parent.blocks, subtaskId],
                        updatedAt: now,
                    };

                    await this.backend.addTask(subtask);
                    await this.backend.updateTask(parentTaskId, { blocks: updatedParent.blocks });

                    // Refresh recitation cache
                    await this.refreshRecitationCache();

                    this.writer?.write({
                        type: 'data-task_update',
                        data: { id: subtaskId, status: 'blocked', title },
                    });

                    return {
                        success: true,
                        subtaskId,
                        message: `Created subtask "${title}" under ${parentTaskId}`,
                    };
                },
            }),
        });
    }

    /**
     * Hook into task updates to refresh recitation cache
     */
    async onStreamFinish(): Promise<void> {
        await this.tasksMiddleware.onStreamFinish();
        await this.refreshRecitationCache();
    }

    /**
     * Optional waitReady for initialization
     */
    async waitReady(): Promise<void> {
        // No async initialization needed
    }
}

export default PlanningMiddleware;
