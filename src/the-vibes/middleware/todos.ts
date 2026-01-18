import {
    tool,
    type UIMessageStreamWriter,
} from 'ai';
import { z } from 'zod';

import StateBackend from '../backend/statebackend';
import { Middleware } from '.';
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
                description: `Create and manage structured task lists for tracking progress through complex workflows.
Use this to break down complex tasks into discrete steps and track your progress.
Mark todos as completed as you finish them.
DO NOT use this for simple, single - step tasks.`,
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

                            // Stream update if writer is available
                            this.writer?.write({
                                type: 'data-todo_update',
                                data: { id: newTodo.id, status: newTodo.status },
                            });
                        }
                        return { success: true, message: `Created ${todos.length} todos` };
                    }

                    if (action === 'update' && todos) {
                        for (const todo of todos) {
                            if (todo.id) {
                                await this.backend.updateTodo(todo.id, todo as Partial<TodoItem>);

                                // Stream update if writer is available
                                this.writer?.write({
                                    type: 'data-todo_update',
                                    data: { id: todo.id, status: todo.status || 'updated' },
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
Use write_todos to plan complex tasks by breaking them into steps.
Mark todos as completed as you progress.
Use read_todos to check current task status.
DO NOT create todos for simple, single - step tasks.`;
    }

    async onStreamFinish() {
        const todos = await this.backend.getTodos();
        const pendingTodos = todos.filter(t => t.status !== 'completed');

        if (pendingTodos.length > 0) {
            this.writer?.write({
                type: 'data-status',
                data: { message: 'Cleaning up pending tasks...' },
            });

            for (const todo of pendingTodos) {
                todo.status = 'completed';
                await this.backend.updateTodo(todo.id, { status: 'completed' });

                this.writer?.write({
                    type: 'data-todo_update',
                    data: { id: todo.id, status: 'completed' },
                });
            }
        }
    }
}