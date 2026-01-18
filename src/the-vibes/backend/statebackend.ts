import { AgentState } from "..";
import { TodoItem } from "../middleware/todos";

/**
 * Internal state manager for the agent. Handles conversation history,
 * virtual file storage, and structured todo list data.
 */
export default class StateBackend {
    private state: AgentState;

    constructor() {
        this.state = {
            messages: [],
            todos: [],
            metadata: {},
        };
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
}