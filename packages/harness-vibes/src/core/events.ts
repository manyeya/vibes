/**
 * Vibes core event & data-part catalog.
 *
 * This module is the single source of truth for the typed `data-*` parts the
 * agent streams to the UI. It lives here (not in `streaming/`) so the new core
 * loop, the UI-stream adapter, and the streaming helpers can all share one
 * definition without importing the streaming layer. `streaming/streaming.ts`
 * re-exports `VibesDataParts` for backward compatibility.
 */

// ============ DATA PART SCHEMAS ============

/**
 * Complete data part schemas for Vibes Agent UI streaming.
 * All data types should be defined here for type safety.
 */
export interface VibesDataParts extends Record<string, unknown> {
    /** System or informational notifications (can be transient - not saved to message history) */
    notification: {
        message: string;
        level: 'info' | 'warning' | 'error';
    };

    /** Current operation status updates */
    status: {
        message: string;
        step?: number;
        totalSteps?: number;
        plugin?: string;
        agentName?: string;
        delegationId?: string;
        operationId?: string;
        parentOperationId?: string;
        phase?: string;
    };

    /** Updates to specific task items for UI synchronization */
    task_update: {
        id: string;
        status: 'pending' | 'blocked' | 'in_progress' | 'completed' | 'failed';
        title?: string;
        priority?: 'low' | 'medium' | 'high' | 'critical';
        error?: string;
    };

    /** Task dependency graph visualization data */
    task_graph: {
        nodes: Array<{
            id: string;
            title: string;
            status: string;
            priority?: string;
        }>;
        edges: Array<{
            from: string;
            to: string;
            type: 'blocks' | 'blockedBy' | 'related';
        }>;
    };

    /** Context summarization progress updates */
    summarization: {
        stage: 'starting' | 'in_progress' | 'complete' | 'failed';
        messageCount: number;
        keepingCount: number;
        saved?: number;
        error?: string;
    };

    /** Tool execution progress updates */
    tool_progress: {
        toolName: string;
        stage?: 'starting' | 'in_progress' | 'complete' | 'failed';
        progress?: number;
        message?: string;
        plugin?: string;
        agentName?: string;
        delegationId?: string;
        operationId?: string;
        parentOperationId?: string;
        attempt?: number;
        elapsedMs?: number;
    };

    /** Error notifications for display in UI */
    error: {
        error: string;
        toolName?: string;
        context?: string;
        recoverable?: boolean;
        plugin?: string;
        agentName?: string;
        delegationId?: string;
        operationId?: string;
        parentOperationId?: string;
        attempt?: number;
    };

    /** Memory system updates */
    memory_update: {
        type: 'lesson' | 'fact' | 'pattern' | 'note';
        action: 'saved' | 'updated' | 'deleted';
        count?: number;
        /** Short title/summary of what was stored (for richer display). */
        title?: string;
        /** Optional content preview. */
        detail?: string;
    };

    /** Sub-agent delegation updates */
    delegation: {
        delegationId: string;
        agentName: string;
        task: string;
        status: 'starting' | 'in_progress' | 'complete' | 'failed';
        artifactPath?: string;
        summary?: string;
        error?: string;
        /** True when the result was reused from cache instead of re-run. */
        cached?: boolean;
        /** True when the summary was inferred from output (no structured completion). */
        inferred?: boolean;
    };

    /** Shell command execution (BashPlugin). */
    command: {
        command: string;
        status: 'running' | 'complete';
        exitCode?: number;
        stdout?: string;
        stderr?: string;
    };

    /** Filesystem operation (FilesystemPlugin: read / write / edit_file / list_files). */
    file_operation: {
        operation: 'read' | 'write' | 'list' | 'edit';
        path: string;
        status: 'running' | 'complete';
        /** Bytes written (write). */
        bytes?: number;
        /** Number of files found (list). */
        fileCount?: number;
        /** A short, truncated file list (list). */
        files?: string[];
        /** Lines added / removed (edit). */
        added?: number;
        removed?: number;
        /** The changed hunk for the diff card (edit); line arrays, may be capped. */
        diff?: { removed: string[]; added: string[] };
    };

    /** Skill activation / discovery (SkillsPlugin). */
    skill: {
        action: 'activate' | 'deactivate' | 'list';
        name?: string;
        /** Available skill names (list). */
        skills?: string[];
    };

    /** Web search results (WebSearchPlugin) — rendered as a sources card. */
    search: {
        query: string;
        status: 'running' | 'complete' | 'failed';
        /** Which backend served the query (exa / tavily / brave). */
        provider?: string;
        /** Normalised result list. */
        results?: Array<{ title: string; url: string; snippet?: string }>;
        count?: number;
        error?: string;
    };

    /**
     * Live context-window usage so the UI can show how full the context is and
     * how much room remains before the conversation is compressed. Emitted each
     * step with a stable id so it updates in place.
     */
    context_usage: {
        /** Estimated tokens currently in the model context. */
        usedTokens: number;
        /** The model's total context window in tokens. */
        contextWindow: number;
        /** Fraction of the window at which compression kicks in (0–1). */
        threshold: number;
        /** Convenience: tokens at which compression triggers (threshold × window). */
        compressAt: number;
    };

    /**
     * A questionnaire the agent is asking the user to fill in (the
     * ClarificationPlugin's `ask_user`). Rendered as a form above the composer;
     * the user's answers come back as the next message. The agent's run stops
     * after asking (via stopWhen) so control returns to the user.
     */
    clarification: {
        id: string;
        title?: string;
        questions: Array<{
            id: string;
            question: string;
            /** Optional helper/context shown under the question. */
            description?: string;
            /**
             * single = pick one · multi = pick several · text = free input ·
             * boolean = yes/no · number = numeric input.
             */
            kind: 'single' | 'multi' | 'text' | 'boolean' | 'number';
            /** Choices for single/multi questions. */
            options?: string[];
            /** Whether single/multi also offer a free-text write-in (default true). */
            allowCustom?: boolean;
            /** multi → min/max selections; number → min/max value. */
            min?: number;
            max?: number;
            /** number → unit suffix (e.g. "$", "items"). */
            unit?: string;
            /** text/number → input placeholder. */
            placeholder?: string;
            /** Whether the question must be answered (default true). */
            required?: boolean;
        }>;
    };

    /**
     * A plan put to the user for review (PlanningPlugin's request_plan_review).
     * Rendered as an approve / request-changes form above the composer; the
     * user's decision returns as their next message.
     */
    plan_review: {
        id: string;
        title: string;
        /** Optional note from the agent introducing the plan. */
        note?: string;
        problem?: string;
        solution?: string;
        phases?: Array<{ name: string; goal: string; steps?: string[] }>;
        milestones?: string[];
        risks?: string[];
        /** The tasks generated from the plan. */
        tasks: Array<{ id: string; title: string; status?: string; priority?: string }>;
    };

    /**
     * A safety guardrail firing: an input/output content guardrail that blocked
     * or redacted, or a per-run budget that was exceeded. Rendered as a small
     * notice banner so the user understands why a turn was halted or altered.
     */
    guardrail: {
        id: string;
        /** Where it fired. 'budget' = a token/cost/tool-call cap. */
        stage: 'input' | 'output' | 'budget';
        /** Name of the guardrail (or 'budget'). */
        guardrail: string;
        /** What happened. */
        action: 'blocked' | 'redacted' | 'exceeded';
        /** Human-readable explanation shown to the user. */
        message: string;
    };

    /**
     * A sub-agent's LIVE narration/output (its streamed final answer), forwarded
     * from the delegated run so the UI can show what the sub-agent is actually
     * doing under its own tab. Accumulating: re-emitted with a stable id as text
     * grows. Carries delegationId/agentName attribution via the scoped writer.
     */
    agent_message: {
        text: string;
        delegationId?: string;
        agentName?: string;
    };

    /** A sub-agent's LIVE reasoning/thinking, forwarded the same way. */
    agent_thought: {
        text: string;
        delegationId?: string;
        agentName?: string;
    };

    /**
     * A renderable artifact (website, document, diagram, chart) produced by the
     * ArtifactPlugin and shown in the canvas side-panel. Streamed with a stable
     * id so updates replace the same part in place; `version` bumps each edit.
     */
    artifact: {
        id: string;
        title: string;
        kind: 'html' | 'markdown' | 'mermaid' | 'chart';
        /** Raw source: HTML, markdown, mermaid syntax, or a chart JSON spec. */
        content: string;
        version: number;
        status: 'streaming' | 'complete';
        /** Sandbox-relative path the artifact was written to. */
        path?: string;
        /** One-line description of what the artifact is. */
        summary?: string;
    };

    /**
     * A declarative workflow (WorkflowPlugin) being saved or executed. The
     * workflow engine runs a graph of AI-SDK-pattern steps (prompt chain,
     * route, parallel, orchestrator-worker, evaluator-optimizer, sub-workflow)
     * making real model calls. Emitted with a stable id so step updates replace
     * the same part in place as the run progresses.
     */
    workflow: {
        id: string;
        name: string;
        /** saved = library write · run = an execution snapshot, re-emitted as it progresses. */
        action: 'saved' | 'run';
        description?: string;
        /** Run status (action === 'run'). */
        status?: 'running' | 'complete' | 'failed';
        /** Live, accumulating list of executed steps in order (action === 'run'). */
        steps?: Array<{
            id: string;
            kind: 'prompt' | 'route' | 'parallel' | 'orchestrator' | 'evaluator' | 'pipeline' | 'workflow' | 'action';
            title?: string;
            status: 'running' | 'complete' | 'failed';
            /** Nesting depth for indentation (top-level = 0). */
            depth?: number;
            /** Short summary of the step's output (complete) or the error. */
            summary?: string;
            /** Fuller output preview, shown when the step is expanded in the UI. */
            detail?: string;
        }>;
        /** Running count of model calls so far (cost awareness). */
        modelCalls?: number;
        error?: string;
    };
}
