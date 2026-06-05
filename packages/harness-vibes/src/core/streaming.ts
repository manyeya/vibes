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

export interface DataStreamMetadata {
    plugin?: string;
    agentName?: string;
    delegationId?: string;
    operationId?: string;
    parentOperationId?: string;
    phase?: string;
}

export interface DataStreamStatusOptions extends DataStreamMetadata {
    id?: string;
    transient?: boolean;
}

export interface DataStreamToolProgressOptions extends DataStreamMetadata {
    id?: string;
    progress?: number;
    message?: string;
    attempt?: number;
    elapsedMs?: number;
}

export interface DataStreamErrorOptions extends DataStreamMetadata {
    id?: string;
    toolName?: string;
    context?: string;
    recoverable?: boolean;
    attempt?: number;
}

export interface DataStreamOperationScope extends DataStreamMetadata {
    name: string;
    toolName?: string;
    operationId?: string;
    heartbeatMessage?: string;
    heartbeatEnabled?: boolean;
}

export interface DataStreamWriterConfig {
    heartbeatStartMs?: number;
    heartbeatIntervalMs?: number;
    now?: () => number;
}

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
        plugin?: string;
        agentName?: string;
        delegationId?: string;
        operationId?: string;
        parentOperationId?: string;
        phase?: string;
    };

    /** Reasoning mode updates */
    reasoning_mode: {
        mode: 'react' | 'tot' | 'plan-execute';
    };

    /** Optional structured reasoning updates */
    reasoning: {
        problem: string;
        count: number;
        context?: string;
    };

    /**
     * Tree-of-Thoughts: the explored branches. Emitted with a stable id per
     * reasoning cycle so the UI updates the same set in place as branches go
     * proposed → evaluated (scored) → selected/discarded.
     */
    reasoning_thoughts: {
        cycle: number;
        thoughts: Array<{
            id: string;
            thought: string;
            expectedOutcome: string;
            confidence: number;
            effort: 'low' | 'medium' | 'high';
            status: 'proposed' | 'evaluated' | 'selected' | 'discarded';
            /** Overall evaluation score (0-10), present once evaluated. */
            score?: number;
            /** Evaluator's reasoning, present once evaluated. */
            reasoning?: string;
        }>;
    };

    /** Tree-of-Thoughts: which branch was ultimately selected. */
    reasoning_selection: {
        cycle: number;
        selectedId: string;
        thought: string;
        expectedOutcome?: string;
        score?: number;
        reasoning?: string;
        discardedIds: string[];
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

    /** Swarm coordination signals */
    swarm_signal: {
        from: string;
        to?: string;
        signal: string;
        data?: Record<string, unknown>;
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

    /** Filesystem operation (FilesystemPlugin). */
    file_operation: {
        operation: 'read' | 'write' | 'list';
        path: string;
        status: 'running' | 'complete';
        /** Bytes written (write). */
        bytes?: number;
        /** Number of files found (list). */
        fileCount?: number;
        /** A short, truncated file list (list). */
        files?: string[];
    };

    /** Skill activation / discovery (SkillsPlugin). */
    skill: {
        action: 'activate' | 'deactivate' | 'list';
        name?: string;
        /** Available skill names (list). */
        skills?: string[];
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
}

// ============ TYPE DEFINITIONS ============

/**
 * Type-safe UI Message for Vibes Agent
 */
export type VibesUIMessage = UIMessage<never, VibesDataParts>;

export interface PluginStreamContext {
    rawWriter: UIMessageStreamWriter<VibesUIMessage>;
    writer: DataStreamWriter;
    streamId: string;
    createOperation(scope: DataStreamOperationScope): DataStreamOperation;
}

const DEFAULT_HEARTBEAT_START_MS = 2000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 2000;

let streamCounter = 0;
let operationCounter = 0;

function nextId(prefix: string): string {
    const counter = prefix === 'stream' ? ++streamCounter : ++operationCounter;
    return `${prefix}-${Date.now()}-${counter.toString(36)}`;
}

function sanitizeScope(value: string): string {
    const sanitized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return sanitized || 'operation';
}

function mergeMetadata(
    defaults: DataStreamMetadata,
    overrides: DataStreamMetadata = {}
): DataStreamMetadata {
    return {
        plugin: overrides.plugin ?? defaults.plugin,
        agentName: overrides.agentName ?? defaults.agentName,
        delegationId: overrides.delegationId ?? defaults.delegationId,
        operationId: overrides.operationId ?? defaults.operationId,
        parentOperationId: overrides.parentOperationId ?? defaults.parentOperationId,
        phase: overrides.phase ?? defaults.phase,
    };
}

function transformDataPart(
    part: any,
    options: {
        defaults?: DataStreamMetadata;
        idPrefix?: string;
    } = {}
): any {
    if (part == null || typeof part !== 'object' || typeof part.type !== 'string' || !part.type.startsWith('data-')) {
        return part;
    }

    const transformed = { ...part };
    if (options.idPrefix && typeof transformed.id === 'string' && transformed.id.length > 0) {
        transformed.id = `${options.idPrefix}${transformed.id}`;
    }

    if (options.defaults) {
        if (
            transformed.type === 'data-status' ||
            transformed.type === 'data-tool_progress' ||
            transformed.type === 'data-error'
        ) {
            // These parts carry the full metadata bag (plugin/phase/operation).
            transformed.data = {
                ...options.defaults,
                ...(transformed.data ?? {}),
            };
        } else if (options.defaults.delegationId || options.defaults.agentName) {
            // Every OTHER data part (command, file_operation, reasoning_*,
            // memory_update, skill, …) gets just the sub-agent attribution so
            // the UI can nest it under the right delegation and show what the
            // sub-agent is actually doing.
            const attribution: Record<string, unknown> = {};
            if (options.defaults.delegationId) attribution.delegationId = options.defaults.delegationId;
            if (options.defaults.agentName) attribution.agentName = options.defaults.agentName;
            transformed.data = {
                ...attribution,
                ...((transformed.data as Record<string, unknown> | undefined) ?? {}),
            };
        }
    }

    return transformed;
}

function pipeMergedStream(
    parentWriter: UIMessageStreamWriter<VibesUIMessage>,
    stream: ReadableStream<any>,
    options: {
        defaults?: DataStreamMetadata;
        idPrefix?: string;
    } = {}
): void {
    void (async () => {
        const reader = stream.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                parentWriter.write(transformDataPart(value, options));
            }
        } catch (error) {
            parentWriter.onError?.(error);
        } finally {
            reader.releaseLock();
        }
    })();
}

// ============ WRITER HELPERS ============

/**
 * Type-safe data stream writer with helper methods
 * Wraps UIMessageStreamWriter to provide consistent data streaming
 */
export class DataStreamWriter {
    constructor(
        private writer: UIMessageStreamWriter<VibesUIMessage> | null | undefined,
        private readonly defaults: DataStreamMetadata = {},
        private readonly config: DataStreamWriterConfig = {}
    ) {}

    /** Check if writer is available */
    get isAvailable(): boolean {
        return this.writer != null;
    }

    /** Access to the underlying raw writer when bridging nested streams */
    get rawWriter(): UIMessageStreamWriter<VibesUIMessage> | null | undefined {
        return this.writer;
    }

    /** Create a derived writer with default metadata applied to relevant parts */
    withDefaults(defaults: DataStreamMetadata): DataStreamWriter {
        return new DataStreamWriter(
            this.writer,
            mergeMetadata(this.defaults, defaults),
            this.config
        );
    }

    createOperation(scope: DataStreamOperationScope): DataStreamOperation {
        const mergedScope: DataStreamOperationScope = {
            ...scope,
            ...mergeMetadata(this.defaults, scope),
        };
        return new DataStreamOperation(this, mergedScope, this.config);
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
        totalSteps?: number,
        options: DataStreamStatusOptions = {}
    ): void {
        if (!this.writer) return;
        const metadata = mergeMetadata(this.defaults, options);
        this.writer.write({
            type: 'data-status',
            ...(options.id ? { id: options.id } : {}),
            data: {
                message,
                step,
                totalSteps,
                ...metadata,
            },
            ...(options.transient ? { transient: true } : {}),
        } as const);
    }

    /** Write reasoning mode update */
    writeReasoningMode(mode: 'react' | 'tot' | 'plan-execute'): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-reasoning_mode',
            id: 'reasoning-mode',
            data: { mode },
        } as const);
    }

    writeReasoning(
        problem: string,
        count: number,
        context?: string
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-reasoning',
            data: { problem, count, context },
        } as const);
    }

    /**
     * Write/replace the Tree-of-Thoughts branch set for a reasoning cycle.
     * Uses a stable id per cycle so the UI updates the same card in place as
     * branches are proposed, then scored, then selected/discarded.
     */
    writeReasoningThoughts(
        cycle: number,
        thoughts: VibesDataParts['reasoning_thoughts']['thoughts']
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-reasoning_thoughts',
            id: `reasoning-thoughts-${cycle}`,
            data: { cycle, thoughts },
        } as const);
    }

    /** Write the selected Tree-of-Thoughts branch for a reasoning cycle. */
    writeReasoningSelection(
        selection: VibesDataParts['reasoning_selection']
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-reasoning_selection',
            id: `reasoning-selection-${selection.cycle}`,
            data: selection,
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
        edges: Array<{ from: string; to: string; type: 'blocks' | 'blockedBy' | 'related' }>,
        options: { id?: string } = {}
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-task_graph',
            id: options.id ?? 'task-graph',
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
            id: 'summarization',
            data: { stage, messageCount, keepingCount, saved, error },
        } as const);
    }

    /** Write tool progress */
    writeToolProgress(
        toolName: string,
        stage: 'starting' | 'in_progress' | 'complete' | 'failed',
        progress?: number,
        options: DataStreamToolProgressOptions = {}
    ): void {
        if (!this.writer) return;
        const metadata = mergeMetadata(this.defaults, options);
        this.writer.write({
            type: 'data-tool_progress',
            ...(options.id ? { id: options.id } : {}),
            data: {
                toolName,
                stage,
                progress,
                message: options.message,
                attempt: options.attempt,
                elapsedMs: options.elapsedMs,
                ...metadata,
            },
        } as const);
    }

    /** Write error notification */
    writeError(
        error: string,
        options: DataStreamErrorOptions = {}
    ): void {
        if (!this.writer) return;
        const metadata = mergeMetadata(this.defaults, options);
        this.writer.write({
            type: 'data-error',
            ...(options.id ? { id: options.id } : {}),
            data: {
                error,
                toolName: options.toolName,
                context: options.context,
                recoverable: options.recoverable,
                attempt: options.attempt,
                ...metadata,
            },
        } as const);
    }

    /** Write memory update */
    writeMemoryUpdate(
        type: 'lesson' | 'fact' | 'pattern' | 'note',
        action: 'saved' | 'updated' | 'deleted',
        count?: number,
        options: { title?: string; detail?: string } = {}
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-memory_update',
            data: { type, action, count, ...options },
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
        delegationId: string,
        agentName: string,
        task: string,
        status: 'starting' | 'in_progress' | 'complete' | 'failed',
        options: {
            artifactPath?: string;
            summary?: string;
            error?: string;
            cached?: boolean;
            inferred?: boolean;
        } = {}
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-delegation',
            id: `delegation-${delegationId}`,
            data: { delegationId, agentName, task, status, ...options },
        } as const);
    }

    /** Write a shell command execution update (stable id per run). */
    writeCommand(
        id: string,
        command: string,
        status: 'running' | 'complete',
        options: { exitCode?: number; stdout?: string; stderr?: string } = {}
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-command',
            id: `command-${id}`,
            data: { command, status, ...options },
        } as const);
    }

    /** Write a filesystem operation update (stable id per op). */
    writeFileOperation(
        id: string,
        operation: 'read' | 'write' | 'list',
        path: string,
        status: 'running' | 'complete',
        options: { bytes?: number; fileCount?: number; files?: string[] } = {}
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-file_operation',
            id: `file-${id}`,
            data: { operation, path, status, ...options },
        } as const);
    }

    /** Write a skill activation / discovery update. */
    writeSkill(
        action: 'activate' | 'deactivate' | 'list',
        options: { name?: string; skills?: string[] } = {}
    ): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-skill',
            id: `skill-${action}-${options.name ?? 'list'}`,
            data: { action, ...options },
        } as const);
    }

    /**
     * Write/replace a renderable artifact. The stable `artifact-<id>` part id
     * means re-emitting the same id (a new version) updates the canvas in place
     * instead of stacking duplicates.
     */
    writeArtifact(artifact: VibesDataParts['artifact']): void {
        if (!this.writer) return;
        this.writer.write({
            type: 'data-artifact',
            id: `artifact-${artifact.id}`,
            data: artifact,
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

export class DataStreamOperation {
    readonly operationId: string;
    readonly toolName: string;

    private readonly metadata: DataStreamMetadata;
    private readonly heartbeatMessage: string;
    private readonly heartbeatEnabled: boolean;
    private readonly startTime: number;
    private heartbeatStartTimer?: ReturnType<typeof setTimeout>;
    private heartbeatIntervalTimer?: ReturnType<typeof setInterval>;
    private closed = false;
    private lastMessage?: string;

    constructor(
        private readonly writer: DataStreamWriter,
        private readonly scope: DataStreamOperationScope,
        private readonly config: DataStreamWriterConfig = {}
    ) {
        this.operationId = scope.operationId ?? `${sanitizeScope(scope.name)}-${nextId('operation')}`;
        this.toolName = scope.toolName ?? scope.name;
        this.metadata = {
            plugin: scope.plugin,
            agentName: scope.agentName,
            delegationId: scope.delegationId,
            operationId: this.operationId,
            parentOperationId: scope.parentOperationId,
            phase: scope.phase,
        };
        this.heartbeatEnabled = scope.heartbeatEnabled !== false;
        this.heartbeatMessage = scope.heartbeatMessage ?? `${scope.name} is still running...`;
        this.startTime = this.now();
        this.scheduleHeartbeat();
    }

    private now(): number {
        return this.config.now?.() ?? Date.now();
    }

    private elapsedMs(): number {
        return Math.max(0, this.now() - this.startTime);
    }

    private scheduleHeartbeat(): void {
        if (!this.writer.isAvailable || !this.heartbeatEnabled) {
            return;
        }

        const startMs = this.config.heartbeatStartMs ?? DEFAULT_HEARTBEAT_START_MS;
        const intervalMs = this.config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
        this.heartbeatStartTimer = setTimeout(() => {
            if (this.closed) {
                return;
            }
            this.heartbeat();
            this.heartbeatIntervalTimer = setInterval(() => {
                if (this.closed) {
                    return;
                }
                this.heartbeat();
            }, intervalMs);
        }, startMs);
    }

    private clearHeartbeat(): void {
        if (this.heartbeatStartTimer) {
            clearTimeout(this.heartbeatStartTimer);
            this.heartbeatStartTimer = undefined;
        }
        if (this.heartbeatIntervalTimer) {
            clearInterval(this.heartbeatIntervalTimer);
            this.heartbeatIntervalTimer = undefined;
        }
    }

    milestone(message: string, options: DataStreamStatusOptions = {}): void {
        this.lastMessage = message;
        this.writer.writeStatus(
            message,
            undefined,
            undefined,
            {
                id: options.id ?? `status:${this.operationId}`,
                ...mergeMetadata(this.metadata, options),
            }
        );
    }

    progress(
        stage: 'starting' | 'in_progress' | 'complete' | 'failed',
        options: DataStreamToolProgressOptions = {}
    ): void {
        if (options.message) {
            this.lastMessage = options.message;
        }

        this.writer.writeToolProgress(
            this.toolName,
            stage,
            options.progress,
            {
                id: options.id ?? `tool_progress:${this.operationId}`,
                ...mergeMetadata(this.metadata, options),
                message: options.message ?? this.lastMessage,
                attempt: options.attempt,
                elapsedMs: options.elapsedMs ?? this.elapsedMs(),
            }
        );

        if (stage === 'complete' || stage === 'failed') {
            this.closed = true;
            this.clearHeartbeat();
        }
    }

    heartbeat(message?: string, options: DataStreamStatusOptions = {}): void {
        this.writer.writeStatus(
            message ?? this.lastMessage ?? this.heartbeatMessage,
            undefined,
            undefined,
            {
                id: options.id ?? `heartbeat:${this.operationId}`,
                transient: true,
                ...mergeMetadata(this.metadata, { ...options, phase: options.phase ?? 'heartbeat' }),
            }
        );
    }

    complete(message?: string, options: DataStreamToolProgressOptions = {}): void {
        if (message) {
            this.milestone(message, {
                phase: options.phase ?? 'complete',
                ...options,
            });
        }
        this.progress('complete', {
            ...options,
            phase: options.phase ?? 'complete',
            message: message ?? options.message,
        });
    }

    fail(
        error: string,
        options: DataStreamErrorOptions & { message?: string } = {}
    ): void {
        this.progress('failed', {
            ...options,
            phase: options.phase ?? 'failed',
            message: options.message ?? this.lastMessage ?? `Failed: ${this.toolName}`,
        });
        this.writer.writeError(error, {
            id: options.id ?? `error:${this.operationId}`,
            ...mergeMetadata(this.metadata, options),
            toolName: options.toolName ?? this.toolName,
            context: options.context,
            recoverable: options.recoverable,
            attempt: options.attempt,
        });
        this.closed = true;
        this.clearHeartbeat();
    }

    child(scope: DataStreamOperationScope): DataStreamOperation {
        return this.writer.createOperation({
            ...scope,
            plugin: scope.plugin ?? this.metadata.plugin,
            agentName: scope.agentName ?? this.metadata.agentName,
            delegationId: scope.delegationId ?? this.metadata.delegationId,
            parentOperationId: scope.parentOperationId ?? this.operationId,
        });
    }
}

/**
 * Create a DataStreamWriter from a UIMessageStreamWriter
 */
export function createDataStreamWriter(
    writer: UIMessageStreamWriter<VibesUIMessage> | null | undefined,
    config: DataStreamWriterConfig = {}
): DataStreamWriter {
    return new DataStreamWriter(writer, {}, config);
}

export function createPluginStreamContext(
    rawWriter: UIMessageStreamWriter<VibesUIMessage>,
    config: DataStreamWriterConfig = {}
): PluginStreamContext {
    const streamId = nextId('stream');
    const writer = createDataStreamWriter(rawWriter, config);
    return {
        rawWriter,
        writer,
        streamId,
        createOperation(scope: DataStreamOperationScope) {
            return writer.createOperation(scope);
        },
    };
}

export function createScopedUIMessageStreamWriter(
    parentWriter: UIMessageStreamWriter<VibesUIMessage>,
    options: {
        defaults?: DataStreamMetadata;
        idPrefix?: string;
    } = {}
): UIMessageStreamWriter<VibesUIMessage> {
    return {
        onError: parentWriter.onError,
        write(part) {
            parentWriter.write(transformDataPart(part, options));
        },
        merge(stream) {
            pipeMergedStream(parentWriter, stream, options);
        },
    };
}

// ============ RE-EXPORTS FOR BACKWARD COMPATIBILITY ============

export default DataStreamWriter;
