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
            files: {},
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

    // File operations

    /** 
     * Writes content to a virtual path in the state storage.
     * @deprecated Use real filesystem via BashMiddleware/write_file instead.
     */
    async writeFile(path: string, content: string): Promise<void> {
        this.state.files[path] = content;
    }

    /** 
     * Reads content from a virtual path.
     * @deprecated Use real filesystem via BashMiddleware/read_file instead.
     */
    async readFile(path: string): Promise<string> {
        if (!this.state.files[path]) {
            throw new Error(`File not found: ${path} `);
        }
        return this.state.files[path];
    }

    /** Lists paths in the virtual storage starting with a prefix */
    async listFiles(dir: string = '/'): Promise<string[]> {
        return Object.keys(this.state.files).filter(p => p.startsWith(dir));
    }

    /** Deletes virtual file from state */
    async deleteFile(path: string): Promise<void> {
        delete this.state.files[path];
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
}