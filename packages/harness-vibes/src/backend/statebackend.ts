import { AgentState } from "../core/types";

/**
 * Internal state manager for the agent. Handles conversation history
 * and structured metadata.
 */
export default class StateBackend {
    private state: AgentState;

    constructor() {
        this.state = {
            messages: [],
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
}
