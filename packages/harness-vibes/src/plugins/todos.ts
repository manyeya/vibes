import {
    tool,
    type UIMessageStreamWriter,
} from 'ai';
import { z } from 'zod';

import {
    VibesUIMessage,
    Plugin,
    PluginStreamContext,
    TodoItem,
    createDataStreamWriter,
    type DataStreamWriter,
} from '../core/types';

/**
 * Plugin that provides a structured Todo List capability,
 * enabling the agent to plan and track its own progress.
 */
export default class TodoListPlugin implements Plugin {
    name = 'TodoListPlugin';
    private writer?: DataStreamWriter;
    private streamContext?: PluginStreamContext;
    private todos: TodoItem[] = [];
    private todosPath: string;

    constructor(config: { todosPath?: string } = {}) {
        this.todosPath = config.todosPath || 'workspace/todos.json';
    }

    onStreamContextReady(context: PluginStreamContext) {
        this.streamContext = context;
        this.writer = context.writer.withDefaults({ plugin: this.name });
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.streamContext = undefined;
        this.writer = createDataStreamWriter(writer).withDefaults({ plugin: this.name });
    }

    get tools() {
        return {
            write_todos: tool({
                description: `Manage a structured todo list to track progress through complex, multi-step tasks.

When to use:
- Complex tasks requiring multiple distinct steps
- Research or investigation workflows
- Tasks that need visible progress tracking

When NOT to use:
- Simple, single-step tasks
- Quick answers or lookups

Workflow:
1. Create todos to break down the task
2. Work on ONE todo at a time
3. Mark it complete BEFORE starting the next
4. Never work on multiple todos simultaneously`,
                inputSchema: z.object({
                    action: z.enum(['create', 'update', 'read']),
                    todos: z.array(z.object({
                        id: z.string().optional(),
                        title: z.string(),
                        status: z.enum(['pending', 'in_progress', 'completed']).optional(),
                        priority: z.enum(['low', 'medium', 'high']).optional(),
                    })).optional(),
                }),
                execute: async ({ action, todos }) => {
                    const operation = this.streamContext?.createOperation({
                        name: 'write-todos',
                        toolName: 'write_todos',
                        plugin: this.name,
                        heartbeatEnabled: false,
                    });
                    if (action === 'create' && todos) {
                        operation?.milestone(`Creating ${todos.length} todo item${todos.length === 1 ? '' : 's'}`, {
                            phase: 'create',
                        });
                        for (const todo of todos) {
                            const newTodo: TodoItem = {
                                id: `todo_${Date.now()}_${Math.random()}`,
                                title: todo.title,
                                status: todo.status || 'pending',
                                priority: todo.priority || 'medium',
                                createdAt: new Date().toISOString(),
                            };
                            this.todos.push(newTodo);

                            // Stream update with full info including title
                            this.writer?.writeTodoUpdate(newTodo.id, newTodo.status, newTodo.title);
                        }
                        operation?.milestone('Persisting todo list', { phase: 'persist' });
                        await this.persistTodos();
                        operation?.complete(`Created ${todos.length} todo item${todos.length === 1 ? '' : 's'}`, {
                            phase: 'complete',
                        });
                        return { success: true, message: `Created ${todos.length} todos` };
                    }

                    if (action === 'update' && todos) {
                        operation?.milestone(`Updating ${todos.length} todo item${todos.length === 1 ? '' : 's'}`, {
                            phase: 'update',
                        });
                        for (const todo of todos) {
                            if (todo.id) {
                                const index = this.todos.findIndex(t => t.id === todo.id);
                                if (index !== -1) {
                                    const existingTodo = this.todos[index];
                                    this.todos[index] = {
                                        ...existingTodo,
                                        ...todo as Partial<TodoItem>,
                                        updatedAt: new Date().toISOString()
                                    };

                                    // Stream update with title
                                    this.writer?.writeTodoUpdate(
                                        todo.id,
                                        (todo.status || existingTodo.status) as TodoItem['status'],
                                        existingTodo.title,
                                    );
                                }
                            }
                        }
                        operation?.milestone('Persisting todo list', { phase: 'persist' });
                        await this.persistTodos();
                        operation?.complete(`Updated ${todos.length} todo item${todos.length === 1 ? '' : 's'}`, {
                            phase: 'complete',
                        });
                        return { success: true, message: `Updated ${todos.length} todos` };
                    }

                    if (action === 'read') {
                        operation?.complete(`Loaded ${this.todos.length} todo item${this.todos.length === 1 ? '' : 's'}`, {
                            phase: 'complete',
                        });
                        return { todos: this.todos };
                    }

                    throw new Error('Invalid action');
                },
            }),

            read_todos: tool({
                description: 'Read the current todo list state',
                inputSchema: z.object({}),
                execute: async () => {
                    return { todos: this.todos };
                },
            }),
        };
    }

    modifySystemPrompt(prompt: string): string {
        return `${prompt}

## Todo List Management

You have access to a todo list for tracking progress through complex tasks.

### When to use todos:
- Multi-step research or investigation tasks
- Complex workflows with distinct phases
- Tasks where progress visibility matters

### When NOT to use todos:
- Simple questions or lookups
- Single-step tasks
- Quick calculations or conversions

### CRITICAL WORKFLOW - Follow exactly:
1. For complex tasks, call write_todos with action='create' to create todos FIRST
2. IMMEDIATELY after creating todos, start working on the FIRST one:
   - Call write_todos with action='update' to set the first todo's status to 'in_progress'
   - Do the actual work for that todo
   - Call write_todos with action='update' to set status to 'completed'
3. Then move to the next todo - repeat step 2
4. Continue until ALL todos are completed
5. NEVER just create todos and stop - you MUST start working on them immediately

### Status Flow (YOU MUST follow this):
pending → in_progress → completed

### Example after creating todos:
\`\`\`
// Create the plan
write_todos({ action: 'create', todos: [...] })

// IMMEDIATELY start the first todo
write_todos({ action: 'update', todos: [{ id: 'todo_xxx', status: 'in_progress' }] })

// Do the work...

// Mark complete
write_todos({ action: 'update', todos: [{ id: 'todo_xxx', status: 'completed' }] })

// Move to next todo...
\`\`\`

This ensures visible, incremental progress to the user.`;
    }

    private async persistTodos(): Promise<void> {
        try {
            const fullPath = require('path').resolve(process.cwd(), this.todosPath);
            Bun.spawnSync(['mkdir', '-p', require('path').dirname(fullPath)]);
            await Bun.write(fullPath, JSON.stringify(this.todos, null, 2));
        } catch (e) {
            console.error('Failed to persist todos:', e);
        }
    }

    private async loadTodos(): Promise<void> {
        try {
            const fullPath = require('path').resolve(process.cwd(), this.todosPath);
            const content = await Bun.file(fullPath).text();
            this.todos = JSON.parse(content);
        } catch (e) {
            this.todos = [];
        }
    }

    async waitReady(): Promise<void> {
        await this.loadTodos();
    }

    async onStreamFinish() {
        // Note: We intentionally do NOT auto-complete pending todos.
        // The agent is responsible for managing its own todo workflow.
        // This follows the langchain-ai/deepagents pattern where todos
        // are a tool the agent uses, not forced architecture.
    }
}
