/**
 * Type-safe data streaming utilities for Vibes Agent
 * Provides standardized helpers for streaming data to the UI
 *
 * @see https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data
 */

import type {
    UIMessage,
    UIMessageStreamWriter,
} from 'ai';

// ============ DATA PART SCHEMAS ============

/**
 * Complete data part schemas for Vibes Agent UI streaming
 * All data types should be defined here for type safety
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
    };

    /** Reasoning mode updates */
    reasoning_mode: {
        mode: 'react' | 'tot' | 'plan-execute';
    };

    /** Updates to specific todo items for UI synchronization */
    todo_update: {
        id: string;
        status: 'pending' | 'in_progress' | 'completed';
        title?: string;
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
        progress?: number; // 0-100
    };

    /** Error notifications for display in UI */
    error: {
        error: string;
        toolName?: string;
        context?: string;
        recoverable?: boolean;
    };

    /** Memory system updates */
    memory_update: {
        type: 'lesson' | 'fact' | 'pattern';
        action: 'saved' | 'updated' | 'deleted';
        count?: number;
    };

    /** Swarm coordination signals */
    swarm_signal: {
        from: string;
        to?: string;
        signal: string;
        data?: Record<string, unknown>;
    };

    /** Sub-agent delegation updates */
    delegation: {
        agentName: string;
        task: string;
        status: 'starting' | 'in_progress' | 'complete' | 'failed';
        result?: unknown;
    };
}

// ============ TYPE DEFINITIONS ============

/**
 * Type-safe UI Message for Vibes Agent
 */
export type VibesUIMessage = UIMessage<never, VibesDataParts>;

// ============ WRITER HELPERS ============

/**
 * Type-safe data stream writer with helper methods
 * Wraps UIMessageStreamWriter to provide consistent data streaming
 */
export class DataStreamWriter {
    constructor(
        private writer: UIMessageStreamWriter<VibesUIMessage> | null | undefined
    ) {}

    /** Check if writer is available */
    get isAvailable(): boolean {
        return this.writer != null;
    }

    /** Write a notification (transient by default - not saved to history) */
    writeNotification(
        message: string,
        level: 'info' | 'warning' | 'error' = 'info'
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-notification',
            data: { message, level },
            transient: true,
        } as const);
    }

    /** Write a status update */
    writeStatus(
        message: string,
        step?: number,
        totalSteps?: number
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-status',
            data: { message, step, totalSteps },
        } as const);
    }

    /** Write reasoning mode update */
    writeReasoningMode(mode: 'react' | 'tot' | 'plan-execute'): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-reasoning_mode',
            data: { mode },
        } as const);
    }

    /** Write todo update */
    writeTodoUpdate(
        id: string,
        status: 'pending' | 'in_progress' | 'completed',
        title?: string
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-todo_update',
            id: `todo-${id}`,
            data: { id, status, title },
        } as const);
    }

    /** Write task update */
    writeTaskUpdate(
        id: string,
        status: 'pending' | 'blocked' | 'in_progress' | 'completed' | 'failed',
        title?: string,
        options: { priority?: 'low' | 'medium' | 'high' | 'critical'; error?: string } = {}
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-task_update',
            id: `task-${id}`,
            data: { id, status, title, ...options },
        } as const);
    }

    /** Write task graph visualization data */
    writeTaskGraph(
        nodes: Array<{ id: string; title: string; status: string; priority?: string }>,
        edges: Array<{ from: string; to: string; type: 'blocks' | 'blockedBy' | 'related' }>
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-task_graph',
            data: { nodes, edges },
        } as const);
    }

    /** Write summarization progress */
    writeSummarization(
        stage: 'starting' | 'in_progress' | 'complete' | 'failed',
        messageCount: number,
        keepingCount: number,
        saved?: number,
        error?: string
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-summarization',
            data: { stage, messageCount, keepingCount, saved, error },
        } as const);
    }

    /** Write tool progress */
    writeToolProgress(
        toolName: string,
        stage: 'starting' | 'in_progress' | 'complete' | 'failed',
        progress?: number
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-tool_progress',
            data: { toolName, stage, progress },
        } as const);
    }

    /** Write error notification */
    writeError(
        error: string,
        options: {
            toolName?: string;
            context?: string;
            recoverable?: boolean;
        } = {}
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-error',
            data: { error, ...options },
        } as const);
    }

    /** Write memory update */
    writeMemoryUpdate(
        type: 'lesson' | 'fact' | 'pattern',
        action: 'saved' | 'updated' | 'deleted',
        count?: number
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-memory_update',
            data: { type, action, count },
        } as const);
    }

    /** Write swarm signal */
    writeSwarmSignal(
        from: string,
        signal: string,
        options: { to?: string; data?: Record<string, unknown> } = {}
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-swarm_signal',
            data: { from, signal, ...options },
        } as const);
    }

    /** Write delegation update */
    writeDelegation(
        agentName: string,
        task: string,
        status: 'starting' | 'in_progress' | 'complete' | 'failed',
        result?: unknown
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-delegation',
            data: { agentName, task, status, result },
        } as const);
    }

    /** Raw write method for custom data parts */
    write(part: {
        type: `data-${string}`;
        id?: string;
        data: unknown;
        transient?: boolean;
    }): void {
        if (!this.writer) return;
        this.writer.write(part as any);
    }
}

/**
 * Create a DataStreamWriter from a UIMessageStreamWriter
 */
export function createDataStreamWriter(
    writer: UIMessageStreamWriter<VibesUIMessage> | null | undefined
): DataStreamWriter {
    return new DataStreamWriter(writer);
}

// ============ RE-EXPORTS FOR BACKWARD COMPATIBILITY ============

export default DataStreamWriter;
