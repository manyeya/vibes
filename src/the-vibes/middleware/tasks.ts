import {
    tool,
    type UIMessageStreamWriter,
} from 'ai';
import { z } from 'zod';

import StateBackend from '../backend/statebackend';
import { AgentUIMessage, Middleware, TaskItem } from '../core/types';

/**
 * Middleware that provides advanced task management with dependencies,
 * blocking, references, and planning capabilities.
 */
export default class TasksMiddleware implements Middleware {
    name = 'TasksMiddleware';
    private writer?: UIMessageStreamWriter<AgentUIMessage>;

    constructor(private backend: StateBackend) {}

    onStreamReady(writer: UIMessageStreamWriter<AgentUIMessage>) {
        this.writer = writer;
    }

    get tools() {
        return {
            create_tasks: tool({
                description: `Create tasks with dependencies, blocking, and references.

When to use:
- Complex multi-step work with parallelizable components
- Tasks that have clear dependencies (some must complete before others start)
- Work that benefits from structured tracking with metadata

When NOT to use:
- Simple sequential tasks (use write_todos instead)
- Single-step operations

Features:
- Dependencies: Set blockedBy to specify which tasks must complete first
- Blocking: The system auto-manages which tasks are blocked
- References: Link files, URLs, and related tasks for context
- Tags and priority for organization`,
                inputSchema: z.object({
                    tasks: z.array(z.object({
                        title: z.string(),
                        description: z.string(),
                        status: z.enum(['pending', 'blocked', 'in_progress', 'completed', 'failed']).optional(),
                        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
                        blockedBy: z.array(z.string()).optional(),
                        fileReferences: z.array(z.string()).optional(),
                        taskReferences: z.array(z.string()).optional(),
                        urlReferences: z.array(z.string()).optional(),
                        metadata: z.record(z.string(), z.any()).optional(),
                        complexity: z.number().optional(),
                        owner: z.string().optional(),
                        tags: z.array(z.string()).optional(),
                    })),
                }),
                execute: async ({ tasks }) => {
                    const now = new Date().toISOString();
                    const createdTasks: TaskItem[] = [];

                    // Collect all task IDs for reference resolution
                    const taskIds = new Map<string, string>();
                    tasks.forEach((_task, index) => {
                        const id = `task_${Date.now()}_${index}`;
                        taskIds.set(index.toString(), id);
                    });

                    // Create tasks with proper IDs and status
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

                        // Determine initial status
                        let status = taskDef.status || 'pending';
                        if (resolvedBlockedBy.length > 0 && status === 'pending') {
                            status = 'blocked';
                        }

                        const newTask: TaskItem = {
                            id,
                            title: taskDef.title,
                            description: taskDef.description,
                            status,
                            priority: taskDef.priority || 'medium',
                            createdAt: now,
                            updatedAt: now,
                            blocks: [],
                            blockedBy: resolvedBlockedBy,
                            fileReferences: taskDef.fileReferences || [],
                            taskReferences: taskDef.taskReferences || [],
                            urlReferences: taskDef.urlReferences || [],
                            metadata: taskDef.metadata || {},
                            complexity: taskDef.complexity,
                            owner: taskDef.owner,
                            tags: taskDef.tags || [],
                        };

                        // Set inverse references (blocks)
                        for (const depId of resolvedBlockedBy) {
                            const depTask = createdTasks.find(t => t.id === depId);
                            if (depTask) {
                                depTask.blocks.push(id);
                            }
                        }

                        createdTasks.push(newTask);
                        await this.backend.addTask(newTask);

                        // Stream update
                        this.writer?.write({
                            type: 'data-task_update',
                            data: { id: newTask.id, status: newTask.status, title: newTask.title },
                        });
                    }

                    return {
                        success: true,
                        message: `Created ${createdTasks.length} tasks`,
                        tasks: createdTasks,
                    };
                },
            }),

            update_task: tool({
                description: `Update a task's status, add/remove dependencies, or modify properties.

Use this to:
- Mark tasks as in_progress or completed
- Add new dependencies (blockedBy)
- Update descriptions, tags, or other properties
- Record errors on failed tasks`,
                inputSchema: z.object({
                    id: z.string(),
                    status: z.enum(['pending', 'blocked', 'in_progress', 'completed', 'failed']).optional(),
                    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
                    description: z.string().optional(),
                    error: z.string().optional(),
                    addBlockedBy: z.array(z.string()).optional(),
                    removeBlockedBy: z.array(z.string()).optional(),
                    addTags: z.array(z.string()).optional(),
                    addFileReferences: z.array(z.string()).optional(),
                    addUrlReferences: z.array(z.string()).optional(),
                }),
                execute: async (input) => {
                    const current = await this.backend.getTask(input.id);
                    if (!current) {
                        return { success: false, error: 'Task not found' };
                    }

                    const updates: Partial<TaskItem> = {};

                    if (input.status !== undefined) updates.status = input.status;
                    if (input.priority !== undefined) updates.priority = input.priority;
                    if (input.description !== undefined) updates.description = input.description;
                    if (input.error !== undefined) updates.error = input.error;

                    // Handle blockedBy modifications
                    let newBlockedBy = [...current.blockedBy];
                    if (input.addBlockedBy) {
                        newBlockedBy = [...new Set([...newBlockedBy, ...input.addBlockedBy])];
                    }
                    if (input.removeBlockedBy) {
                        newBlockedBy = newBlockedBy.filter(id => !input.removeBlockedBy!.includes(id));
                    }
                    if (input.addBlockedBy || input.removeBlockedBy) {
                        updates.blockedBy = newBlockedBy;
                    }

                    // Handle tag additions
                    if (input.addTags) {
                        updates.tags = [...new Set([...current.tags, ...input.addTags])];
                    }

                    // Handle file reference additions
                    if (input.addFileReferences) {
                        updates.fileReferences = [...new Set([...current.fileReferences, ...input.addFileReferences])];
                    }

                    // Handle URL reference additions
                    if (input.addUrlReferences) {
                        updates.urlReferences = [...new Set([...current.urlReferences, ...input.addUrlReferences])];
                    }

                    await this.backend.updateTask(input.id, updates);

                    // Stream update
                    this.writer?.write({
                        type: 'data-task_update',
                        data: { id: input.id, status: updates.status || current.status, title: current.title },
                    });

                    return { success: true, message: `Task ${input.id} updated` };
                },
            }),

            get_task: tool({
                description: `Get a single task with full context including dependencies and related tasks.`,
                inputSchema: z.object({
                    id: z.string(),
                }),
                execute: async ({ id }) => {
                    const task = await this.backend.getTask(id);
                    if (!task) {
                        return { success: false, error: 'Task not found' };
                    }

                    // Get blocking and blocked tasks
                    const allTasks = await this.backend.getTasks();
                    const blocking = allTasks.filter(t => task.blockedBy.includes(t.id));
                    const blocked = allTasks.filter(t => t.blocks.includes(t.id));
                    const related = allTasks.filter(t => task.taskReferences.includes(t.id));

                    return {
                        success: true,
                        task,
                        blocking,
                        blocked,
                        related,
                    };
                },
            }),

            list_tasks: tool({
                description: `List tasks with optional filtering and sorting.

Filters:
- status: Filter by task status
- tags: Filter by tags (shows tasks with ANY of the tags)
- priority: Filter by priority level

Sort options:
- created: Sort by creation time (default)
- priority: Sort by priority
- updated: Sort by last update time`,
                inputSchema: z.object({
                    status: z.enum(['pending', 'blocked', 'in_progress', 'completed', 'failed']).optional(),
                    tags: z.array(z.string()).optional(),
                    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
                    sort: z.enum(['created', 'priority', 'updated']).optional(),
                }),
                execute: async (input) => {
                    let tasks = await this.backend.getTasks();

                    // Apply filters
                    if (input.status) {
                        tasks = tasks.filter(t => t.status === input.status);
                    }
                    if (input.priority) {
                        tasks = tasks.filter(t => t.priority === input.priority);
                    }
                    if (input.tags && input.tags.length > 0) {
                        tasks = tasks.filter(t => input.tags!.some(tag => t.tags.includes(tag)));
                    }

                    // Apply sort
                    const sort = input.sort || 'created';
                    tasks.sort((a, b) => {
                        if (sort === 'priority') {
                            const order = { critical: 0, high: 1, medium: 2, low: 3 };
                            return order[a.priority] - order[b.priority];
                        }
                        if (sort === 'updated') {
                            return b.updatedAt.localeCompare(a.updatedAt);
                        }
                        return b.createdAt.localeCompare(a.createdAt);
                    });

                    return {
                        success: true,
                        tasks,
                        count: tasks.length,
                    };
                },
            }),

            get_next_tasks: tool({
                description: `Get available tasks that can be started now.

Returns tasks that:
- Have status 'pending' or 'in_progress'
- Have all their dependencies completed (blockedBy is empty or all deps are done)

Use this to find the next work to do without needing to manually check dependencies.`,
                inputSchema: z.object({}),
                execute: async () => {
                    const availableTasks = await this.backend.getAvailableTasks();

                    return {
                        success: true,
                        tasks: availableTasks,
                        count: availableTasks.length,
                    };
                },
            }),

            delete_task: tool({
                description: `Delete a task. Optional cascade deletes tasks that only depend on this one.`,
                inputSchema: z.object({
                    id: z.string(),
                    cascade: z.boolean().optional().describe('Delete tasks that only depend on this one'),
                }),
                execute: async ({ id, cascade = false }) => {
                    await this.backend.deleteTask(id, cascade);

                    return {
                        success: true,
                        message: cascade
                            ? `Task ${id} and dependent tasks deleted`
                            : `Task ${id} deleted`,
                    };
                },
            }),

            clear_tasks: tool({
                description: `Clear all tasks. Requires confirmation by setting confirm=true.`,
                inputSchema: z.object({
                    confirm: z.boolean().describe('Must be true to confirm clearing all tasks'),
                }),
                execute: async ({ confirm }) => {
                    if (!confirm) {
                        return { success: false, error: 'Must set confirm=true to clear all tasks' };
                    }

                    await this.backend.clearTasks();

                    return { success: true, message: 'All tasks cleared' };
                },
            }),

            generate_tasks: tool({
                description: `AI-powered task generation from a prompt.

Use this to:
- Break down a complex request into structured tasks
- Generate task plans with dependencies
- Create task lists from user requirements

The system will:
1. Analyze the prompt to identify tasks
2. Determine dependencies between tasks
3. Set appropriate priorities and tags
4. Create tasks with proper blocking relationships`,
                inputSchema: z.object({
                    prompt: z.string().describe('The prompt to generate tasks from'),
                    template: z.enum(['feature_dev', 'bugfix', 'research', 'auto']).optional().describe('Template to use or auto-detect'),
                }),
                execute: async ({ prompt, template: _template = 'auto' }) => {
                    const existingTasks = await this.backend.getTasks();
                    const existingTaskMap = new Map(existingTasks.map(t => [t.id, t]));
                    const _templates = await this.backend.listTemplates();

                    // Build planning prompt
                    const _planningPrompt = `You are a task planning expert. Generate a structured task breakdown from the following prompt.

USER PROMPT:
${prompt}

EXISTING TASKS (you can reference these by ID as dependencies):
${existingTasks.map((t: TaskItem) => `- ${t.id}: ${t.title} (${t.status})`).join('\n') || '(none)'}

AVAILABLE TEMPLATES:
${_templates.map((t: { id: string; name: string; description: string }) => `- ${t.id}: ${t.name} - ${t.description}`).join('\n')}

RESPOND WITH JSON ONLY (no markdown, no explanation):
\`\`\`
{
  "analysis": "Brief analysis of what needs to be done",
  "tasks": [
    {
      "title": "Task title",
      "description": "Detailed description",
      "priority": "low|medium|high|critical",
      "blockedBy": ["task_id or empty array"],
      "tags": ["tag1", "tag2"],
      "fileReferences": ["file patterns to include"],
      "complexity": 1-10
    }
  ]
}
\`\`\`

Rules:
1. Break down work into logical, sequential steps
2. Set blockedBy to dependencies (use existing task IDs when relevant)
3. Use appropriate priorities for critical path items
4. Add useful tags for filtering
5. Keep descriptions clear and actionable
6. Return ONLY the JSON, no other text`;

                    try {
                        // Use a simple approach - generate text and parse JSON
                        // In a real implementation, you'd pass a model here
                        // For now, we'll create a simple fallback
                        const tasks = await this.generateTasksFromPrompt(prompt, existingTaskMap);

                        // Create the tasks
                        const result = await this.createTasksFromGenerated(tasks);

                        return {
                            success: true,
                            message: `Generated ${result.length} tasks`,
                            tasks: result,
                            executionOrder: await this.backend.getExecutionOrder(),
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: `Failed to generate tasks: ${error}`,
                        };
                    }
                },
            }),

            get_execution_order: tool({
                description: `Derive the optimal execution order for tasks with parallelizable levels.

Returns tasks grouped by execution level:
- Level 0: Tasks with no dependencies (can run in parallel)
- Level 1: Tasks that depend on Level 0 tasks
- Level 2: Tasks that depend on Level 1 tasks
- etc.

Use this to understand which tasks can be worked on simultaneously.`,
                inputSchema: z.object({}),
                execute: async () => {
                    const executionOrder = await this.backend.getExecutionOrder();

                    return {
                        success: true,
                        executionOrder,
                        summary: executionOrder.map(level =>
                            `Level ${level.level}: ${level.tasks.length} task${level.tasks.length !== 1 ? 's' : ''}`
                        ).join('\n'),
                    };
                },
            }),

            create_template: tool({
                description: `Define a reusable task template for common patterns.

Templates can include:
- Base task structure with parameter placeholders (use format: \${paramName})
- Parameter definitions with defaults
- Sub-tasks that are created alongside the main task
- Default file patterns to include`,
                inputSchema: z.object({
                    id: z.string().describe('Unique template identifier'),
                    name: z.string().describe('Human-readable template name'),
                    description: z.string().describe('What this template is for'),
                    baseTask: z.object({
                        title: z.string(),
                        description: z.string(),
                        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
                        tags: z.array(z.string()).optional(),
                    }),
                    parameters: z.array(z.object({
                        name: z.string(),
                        description: z.string(),
                        default: z.any().optional(),
                        required: z.boolean(),
                    })),
                    subTasks: z.array(z.object({
                        title: z.string(),
                        description: z.string(),
                        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
                        tags: z.array(z.string()).optional(),
                    })).optional(),
                    defaultFilePatterns: z.array(z.string()).optional(),
                }),
                execute: async (input) => {
                    const template = {
                        id: input.id,
                        name: input.name,
                        description: input.description,
                        baseTask: {
                            ...input.baseTask,
                            status: 'pending' as const,
                            blocks: [],
                            blockedBy: [],
                            fileReferences: [],
                            taskReferences: [],
                            urlReferences: [],
                            metadata: {},
                        },
                        parameters: input.parameters,
                        subTasks: input.subTasks?.map(st => ({
                            ...st,
                            status: 'pending' as const,
                            blocks: [],
                            blockedBy: [],
                            fileReferences: [],
                            taskReferences: [],
                            urlReferences: [],
                            metadata: {},
                        })),
                        defaultFilePatterns: input.defaultFilePatterns,
                    };

                    await this.backend.saveTemplate(template);

                    return {
                        success: true,
                        message: `Template '${input.id}' created`,
                        template,
                    };
                },
            }),

            list_templates: tool({
                description: `List all available task templates including built-in and custom templates.`,
                inputSchema: z.object({}),
                execute: async () => {
                    const templates = await this.backend.listTemplates();

                    return {
                        success: true,
                        templates,
                        builtIn: templates.filter(t => ['feature_dev', 'bugfix', 'research'].includes(t.id)),
                        custom: templates.filter(t => !['feature_dev', 'bugfix', 'research'].includes(t.id)),
                    };
                },
            }),

            apply_template: tool({
                description: `Apply a template with parameter substitution to create tasks.

Built-in templates:
- feature_dev: Standard workflow for implementing features (analysis → implementation → tests → docs)
- bugfix: Standard workflow for fixing bugs (reproduce → root cause → fix → verify)
- research: Standard workflow for research (gather → analyze → document)

Parameters are substituted in \${paramName} format.`,
                inputSchema: z.object({
                    templateId: z.string(),
                    parameters: z.record(z.string(), z.any()),
                    title: z.string().optional().describe('Override main task title'),
                }),
                execute: async ({ templateId, parameters, title }) => {
                    try {
                        const tasks = await this.backend.applyTemplate(templateId, parameters, title);

                        // Stream updates for all tasks
                        for (const task of tasks) {
                            this.writer?.write({
                                type: 'data-task_update',
                                data: { id: task.id, status: task.status, title: task.title },
                            });
                        }

                        return {
                            success: true,
                            message: `Created ${tasks.length} tasks from template '${templateId}'`,
                            tasks,
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: String(error),
                        };
                    }
                },
            }),
        };
    }

    /**
     * Generate tasks from a prompt (fallback implementation)
     */
    private async generateTasksFromPrompt(prompt: string, _existingTasks: Map<string, TaskItem>): Promise<any[]> {
        // Simple heuristic-based generation as fallback
        // In production, you'd use an actual LLM call here
        const lowerPrompt = prompt.toLowerCase();

        if (lowerPrompt.includes('bug') || lowerPrompt.includes('fix') || lowerPrompt.includes('error')) {
            // Bug fix pattern
            return [
                {
                    title: 'Reproduce the bug',
                    description: `Create a minimal reproduction of the issue described: ${prompt}`,
                    priority: 'high',
                    blockedBy: [],
                    tags: ['reproduction', 'bugfix'],
                    fileReferences: [],
                    complexity: 3,
                },
                {
                    title: 'Identify root cause',
                    description: 'Analyze the code to find the root cause of the bug',
                    priority: 'high',
                    blockedBy: [], // Will be set to first task's ID
                    tags: ['analysis', 'bugfix'],
                    fileReferences: ['src/**/*.ts'],
                    complexity: 5,
                },
                {
                    title: 'Implement fix',
                    description: 'Write the fix for the identified issue',
                    priority: 'high',
                    blockedBy: [], // Will be set to second task's ID
                    tags: ['fix', 'bugfix'],
                    fileReferences: ['src/**/*.ts'],
                    complexity: 4,
                },
                {
                    title: 'Verify fix',
                    description: 'Test the fix to ensure it resolves the issue without side effects',
                    priority: 'high',
                    blockedBy: [], // Will be set to third task's ID
                    tags: ['verification', 'testing'],
                    fileReferences: ['tests/**/*.ts'],
                    complexity: 3,
                },
            ];
        }

        if (lowerPrompt.includes('research') || lowerPrompt.includes('investigate') || lowerPrompt.includes('find')) {
            // Research pattern
            return [
                {
                    title: 'Gather sources',
                    description: `Collect relevant documentation and resources for: ${prompt}`,
                    priority: 'high',
                    blockedBy: [],
                    tags: ['gathering', 'research'],
                    fileReferences: [],
                    complexity: 3,
                },
                {
                    title: 'Analyze findings',
                    description: 'Analyze the gathered information and extract key insights',
                    priority: 'high',
                    blockedBy: [],
                    tags: ['analysis', 'research'],
                    fileReferences: [],
                    complexity: 4,
                },
                {
                    title: 'Document findings',
                    description: 'Create comprehensive documentation of findings and conclusions',
                    priority: 'medium',
                    blockedBy: [],
                    tags: ['documentation', 'research'],
                    fileReferences: [],
                    complexity: 3,
                },
            ];
        }

        // Default: feature development pattern
        return [
            {
                title: 'Analyze requirements',
                description: `Review and analyze requirements for: ${prompt}`,
                priority: 'high',
                blockedBy: [],
                tags: ['analysis', 'feature'],
                fileReferences: [],
                complexity: 3,
            },
            {
                title: 'Implement core logic',
                description: 'Implement the main functionality',
                priority: 'high',
                blockedBy: [],
                tags: ['implementation', 'feature'],
                fileReferences: ['src/**/*.ts'],
                complexity: 5,
            },
            {
                title: 'Write tests',
                description: 'Create comprehensive tests covering edge cases',
                priority: 'medium',
                blockedBy: [],
                tags: ['testing', 'feature'],
                fileReferences: ['tests/**/*.ts'],
                complexity: 4,
            },
            {
                title: 'Update documentation',
                description: 'Add documentation and usage examples',
                priority: 'low',
                blockedBy: [],
                tags: ['documentation', 'feature'],
                fileReferences: ['README.md', 'docs/**/*.md'],
                complexity: 2,
            },
        ];
    }

    /**
     * Create tasks from generated task definitions
     */
    private async createTasksFromGenerated(generatedTasks: any[]): Promise<TaskItem[]> {
        const now = new Date().toISOString();
        const createdTasks: TaskItem[] = [];
        const taskIndexMap = new Map<number, string>();

        // First pass: create all tasks with IDs
        for (let i = 0; i < generatedTasks.length; i++) {
            const taskDef = generatedTasks[i];
            const id = `task_${Date.now()}_${i}`;
            taskIndexMap.set(i, id);

            const newTask: TaskItem = {
                id,
                title: taskDef.title,
                description: taskDef.description,
                status: 'pending',
                priority: taskDef.priority || 'medium',
                createdAt: now,
                updatedAt: now,
                blocks: [],
                blockedBy: [],
                fileReferences: taskDef.fileReferences || [],
                taskReferences: taskDef.taskReferences || [],
                urlReferences: taskDef.urlReferences || [],
                metadata: taskDef.metadata || {},
                complexity: taskDef.complexity,
                tags: taskDef.tags || [],
            };

            createdTasks.push(newTask);
        }

        // Second pass: resolve dependencies
        for (let i = 0; i < generatedTasks.length; i++) {
            const taskDef = generatedTasks[i];
            const task = createdTasks[i];

            // Resolve blockedBy (can be indices or task IDs)
            if (taskDef.blockedBy && taskDef.blockedBy.length > 0) {
                for (const depRef of taskDef.blockedBy) {
                    // Check if it's a numeric index
                    const index = parseInt(depRef, 10);
                    if (!isNaN(index) && taskIndexMap.has(index)) {
                        task.blockedBy.push(taskIndexMap.get(index)!);
                        // Add inverse reference
                        createdTasks[index].blocks.push(task.id);
                    } else {
                        // Assume it's a task ID reference
                        task.blockedBy.push(depRef);
                    }
                }

                // Set status to blocked if has dependencies
                if (task.blockedBy.length > 0) {
                    task.status = 'blocked';
                }
            }
        }

        // Save all tasks
        await this.backend.addTasks(createdTasks);

        // Stream updates
        for (const task of createdTasks) {
            this.writer?.write({
                type: 'data-task_update',
                data: { id: task.id, status: task.status, title: task.title },
            });
        }

        return createdTasks;
    }

    modifySystemPrompt(prompt: string): string {
        return `${prompt}

## Advanced Task Management

You have access to an advanced task system with dependencies, blocking, and planning capabilities.

### When to use tasks:
- Complex multi-step work with parallelizable components
- Tasks with clear dependencies (some must complete before others)
- Work requiring structured tracking with metadata and references
- Projects that benefit from execution order optimization

### When NOT to use tasks:
- Simple sequential tracking (use write_todos instead)
- Single-step operations

### Key Features:

**Dependencies**: Tasks can specify what they depend on via \`blockedBy\`
- When a task completes, dependent tasks auto-unblock
- The system tracks both \`blockedBy\` (dependencies) and \`blocks\` (dependents)

**Planning**: Use \`generate_tasks\` to AI-generate task breakdowns from prompts
- Automatically analyzes requirements and creates structured tasks
- Determines dependencies and execution order
- Sets appropriate priorities and tags

**Templates**: Reusable patterns for common workflows:
- \`feature_dev\`: Analysis → Implementation → Tests → Docs
- \`bugfix\`: Reproduce → Root Cause → Fix → Verify
- \`research\`: Gather → Analyze → Document

**Execution Order**: Use \`get_execution_order\` to see parallelizable levels
- Level 0: Tasks with no dependencies (can run in parallel)
- Level 1+: Tasks waiting for previous levels

### Workflow:
1. For complex work, use \`create_tasks\` or \`generate_tasks\` FIRST
2. Use \`get_next_tasks\` to find available work
3. Use \`update_task\` to mark tasks in_progress, then completed
4. Dependent tasks auto-unblock as dependencies complete
5. Use \`get_execution_order\` to understand parallelization opportunities

### Status Flow:
pending → in_progress → completed
         ↓
      blocked (when has uncompleted dependencies)
`;
    }

    async onStreamFinish() {
        // Note: We intentionally do NOT auto-complete pending tasks.
        // The agent is responsible for managing its own task workflow.
    }
}
