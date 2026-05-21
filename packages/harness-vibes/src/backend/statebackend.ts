import { AgentState } from "../core/types";

/**
 * Abstract base for agent state persistence.
 *
 * Concrete backends (in-memory, SQLite, Postgres, …) implement `getState`
 * and `setState`. Multi-session storage operations (listSessions, …)
 * stay on the concrete classes that support them; consumers that only
 * need to read/write the active session's state should depend on this
 * abstract type rather than a specific backend.
 */
export default abstract class StateBackend {
    abstract getState(): AgentState;
    abstract setState(state: Partial<AgentState>): void;
}

/**
 * In-memory state backend. Useful for tests and ephemeral workloads
 * where persistence across process restarts is not required.
 */
export class InMemoryStateBackend extends StateBackend {
    private state: AgentState;

    constructor() {
        super();
        this.state = {
            messages: [],
            metadata: {},
        };
    }

    getState(): AgentState {
        return this.state;
    }

    setState(state: Partial<AgentState>): void {
        this.state = { ...this.state, ...state };
    }
}
