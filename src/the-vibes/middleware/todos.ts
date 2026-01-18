import {
    tool,
    type UIMessageStreamWriter,
} from 'ai';
import { z } from 'zod';

import StateBackend from '../backend/statebackend';
import { Middleware } from ".";
import { AgentUIMessage } from '..';

/**
 * A single item in the agent's internal todo list.
 */
export interface TodoItem {
    /** Unique identifier for the todo item */
    id: string;
    /** Human-readable title of the task */
    title: string;
    /** Current status of the task */
    status: 'pending' | 'in_progress' | 'completed';
    /** Task priority level */
    priority: 'low' | 'medium' | 'high';
    /** ISO timestamp when the task was created */
    createdAt: string;
}

/**
 * Middleware that provides a structured Todo List capability,
 * enabling the agent to plan and track its own progress.
 */
export default class TodoListMiddleware implements Middleware {
    name = 'TodoListMiddleware';
    private writer?: UIMessageStreamWriter<AgentUIMessage>;

    constructor(private backend: StateBackend) { }

    onStreamReady(writer: UIMessageStreamWriter<AgentUIMessage>) {
        this.writer = writer;
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
                    if (action === 'create' && todos) {
                        for (const todo of todos) {
                            const newTodo: TodoItem = {
                                id: `todo_${Date.now()}_${Math.random()}`,
                                title: todo.title,
                                status: todo.status || 'pending',
                                priority: todo.priority || 'medium',
                                createdAt: new Date().toISOString(),
                            };
                            await this.backend.addTodo(newTodo);

                            // Stream update with full info including title
                            this.writer?.write({
                                type: 'data-todo_update',
                                data: { id: newTodo.id, status: newTodo.status, title: newTodo.title },
                            });
                        }
                        return { success: true, message: `Created ${todos.length} todos` };
                    }

                    if (action === 'update' && todos) {
                        for (const todo of todos) {
                            if (todo.id) {
                                // Get existing todo to get title
                                const existingTodo = (await this.backend.getTodos()).find(t => t.id === todo.id);
                                await this.backend.updateTodo(todo.id, todo as Partial<TodoItem>);

                                // Stream update with title
                                this.writer?.write({
                                    type: 'data-todo_update',
                                    data: {
                                        id: todo.id,
                                        status: todo.status || 'updated',
                                        title: existingTodo?.title || todo.title,
                                    },
                                });
                            }
                        }
                        return { success: true, message: `Updated ${todos.length} todos` };
                    }

                    if (action === 'read') {
                        const allTodos = await this.backend.getTodos();
                        return { todos: allTodos };
                    }

                    return { error: 'Invalid action' };
                },
            }),

            read_todos: tool({
                description: 'Read the current todo list state',
                inputSchema: z.object({}),
                execute: async () => {
                    return { todos: await this.backend.getTodos() };
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

    async onStreamFinish() {
        // Note: We intentionally do NOT auto-complete pending todos.
        // The agent is responsible for managing its own todo workflow.
        // This follows the langchain-ai/deepagents pattern where todos
        // are a tool the agent uses, not forced architecture.
    }
}