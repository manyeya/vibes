import { UIMessageStreamWriter } from "ai";
import { AgentState, AgentUIMessage } from "..";
import TodoListMiddleware from "./todos";
import SkillsMiddleware from "./skill";
import BashMiddleware from "./bash";
import SubAgentMiddleware from "./subagent";

/**
 * Interface for agent middleware that can extend capabilities,
 * modify prompts, or run logic before/after model execution.
 */

interface Middleware {
    /** Display name of the middleware */
    name: string;
    /** Optional collection of tools provided by this middleware to the agent */
    tools?: Record<string, any>;
    /** Hook executed before the model is called */
    beforeModel?: (state: AgentState) => Promise<void>;
    /** Hook executed after the model provides a response */
    afterModel?: (state: AgentState, response: any) => Promise<void>;
    /** Function to modify or extend the system prompt */
    modifySystemPrompt?: (prompt: string) => string;
    /** Optional promise to wait for during initialization (e.g., sandbox startup) */
    waitReady?: () => Promise<void>;
    /** Optional hook to receive a data stream writer for real-time UI updates */
    onStreamReady?: (writer: UIMessageStreamWriter<AgentUIMessage>) => void;
    /** Optional hook executed when the stream finishes (successful completion) */
    onStreamFinish?: (result: any) => Promise<void>;
}

export {
    Middleware,
    TodoListMiddleware,
    SkillsMiddleware,
    BashMiddleware,
    SubAgentMiddleware
}

