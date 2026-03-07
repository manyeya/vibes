import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { hasToolCall, type LanguageModel, type Tool, type UIMessageStreamWriter, tool } from 'ai';
import z from 'zod';
import {
    VibesUIMessage,
    Plugin,
    SubAgent,
    ToolsRequiringApprovalConfig,
    VibeAgentConfig,
    createDataStreamWriter,
    type DataStreamWriter,
} from '../core/types';
import { VibeAgent } from '../core/agent';

const COMPLETION_TOOL_NAME = 'task_completion';
const DELEGATION_TOOL_NAMES = ['task', 'delegate', 'parallel_delegate'] as const;
const DELEGATION_TOOL_NAME_SET = new Set<string>(DELEGATION_TOOL_NAMES);

const completionSchema = z.object({
    summary: z.string().min(1).describe('A concise summary of what was completed.'),
    files: z.array(z.string()).default([]).describe('Files created or modified while completing the task.'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Optional structured metadata about the completed work.'),
});

const delegationInputSchema = z.object({
    agent_name: z.string().describe('Name of the sub-agent to use.'),
    task: z.string().describe('The task to delegate.'),
    context: z.record(z.string(), z.unknown()).optional().describe('Optional structured context for the sub-agent.'),
    relevantFiles: z.array(z.string()).optional().describe('Optional file paths that are likely relevant to the task.'),
});

export type CompletionPayload = z.infer<typeof completionSchema>;

type DelegationErrorCode = 'missing_completion' | 'post_completion_activity' | 'invalid_config' | 'subagent_failed';
type ArtifactMode = 'always' | 'errors-only' | 'never';

type BuiltInPluginFactory = (options: {
    model?: LanguageModel;
    workspaceDir?: string;
}) => Plugin[];

type AgentFactory = (config: VibeAgentConfig) => VibeAgent;

interface DelegationInput extends z.infer<typeof delegationInputSchema> {}

interface DelegationSuccessResult {
    status: 'completed';
    delegationId: string;
    summary: string;
    cached: boolean;
    savedTo?: string;
    filesCreated?: string[];
    completionConfirmed: true;
}

interface DelegationErrorResult {
    status: 'error';
    delegationId: string;
    summary: string;
    error: string;
    errorCode: DelegationErrorCode;
    savedTo?: string;
}

export interface DelegationRegistryEntry {
    delegationId: string;
    timestamp: number;
    agentName: string;
    taskSignature: string;
    summary: string;
    artifactPath?: string;
    filesCreated: string[];
}

export interface ParallelDelegationResult {
    delegationId: string;
    task: string;
    agentName: string;
    success: boolean;
    result?: DelegationSuccessResult;
    error?: string;
    errorCode?: DelegationErrorCode;
}

interface NormalizedSubAgentBase {
    name: string;
    description: string;
    systemPrompt: string;
    model?: LanguageModel;
    allowSubdelegation: boolean;
    artifactMode: ArtifactMode;
}

export interface NormalizedCustomSubAgent extends NormalizedSubAgentBase {
    mode: 'custom';
    tools: Record<string, Tool<any, any>>;
    plugins: Plugin[];
    allowedTools?: string[];
    blockedTools?: string[];
    toolsRequiringApproval?: ToolsRequiringApprovalConfig;
}

export interface NormalizedGeneralPurposeSubAgent extends NormalizedSubAgentBase {
    mode: 'general-purpose';
    allowedTools?: string[];
    blockedTools?: string[];
}

export type NormalizedSubAgent = NormalizedCustomSubAgent | NormalizedGeneralPurposeSubAgent;

interface CompletionTracker {
    callCount: number;
    payload: CompletionPayload | null;
}

interface ExecutionResult {
    rawResult: Awaited<ReturnType<VibeAgent['generate']>>;
    completionPayload: CompletionPayload | null;
}

class DelegationConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DelegationConfigError';
    }
}

class DelegationRegistry {
    private entries = new Map<string, DelegationRegistryEntry>();

    constructor(private readonly defaultTTL: number) {}

    private getSignature(agentName: string, request: DelegationInput): string {
        const payload = JSON.stringify({
            agentName,
            task: request.task,
            context: request.context ?? null,
            relevantFiles: request.relevantFiles ?? [],
        });

        let hash = 2166136261;
        for (let index = 0; index < payload.length; index++) {
            hash ^= payload.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }

        return `${agentName}:${hash >>> 0}`;
    }

    get(agentName: string, request: DelegationInput, ttl?: number): DelegationRegistryEntry | null {
        const signature = this.getSignature(agentName, request);
        const entry = this.entries.get(signature);
        if (!entry) {
            return null;
        }

        const effectiveTTL = ttl ?? this.defaultTTL;
        if (Date.now() - entry.timestamp > effectiveTTL) {
            this.entries.delete(signature);
            return null;
        }

        return entry;
    }

    set(agentName: string, request: DelegationInput, entry: Omit<DelegationRegistryEntry, 'taskSignature'>): DelegationRegistryEntry {
        const taskSignature = this.getSignature(agentName, request);
        const registryEntry: DelegationRegistryEntry = {
            ...entry,
            taskSignature,
        };

        this.entries.set(taskSignature, registryEntry);
        return registryEntry;
    }

    delete(agentName: string, request: DelegationInput): void {
        this.entries.delete(this.getSignature(agentName, request));
    }

    clear(): void {
        this.entries.clear();
    }

    getAllEntries(): DelegationRegistryEntry[] {
        return Array.from(this.entries.values());
    }
}

function cloneApprovalConfig(config: ToolsRequiringApprovalConfig): ToolsRequiringApprovalConfig {
    return Array.isArray(config) ? [...config] : { ...config };
}

function mergeBlockedTools(blockedTools: string[] | undefined, allowSubdelegation: boolean): string[] | undefined {
    const merged = new Set(blockedTools ?? []);
    if (!allowSubdelegation) {
        for (const toolName of DELEGATION_TOOL_NAME_SET) {
            merged.add(toolName);
        }
    }

    return merged.size > 0 ? Array.from(merged) : undefined;
}

function filterApprovalConfig(
    config: ToolsRequiringApprovalConfig,
    availableToolNames: Set<string>
): ToolsRequiringApprovalConfig {
    if (Array.isArray(config)) {
        return config.filter(toolName => availableToolNames.has(toolName));
    }

    return Object.fromEntries(
        Object.entries(config).filter(([toolName]) => availableToolNames.has(toolName))
    );
}

function truncateTask(task: string): string {
    return task.length > 160 ? `${task.slice(0, 157)}...` : task;
}

function sanitizeFileComponent(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'subagent';
}

function formatMetadata(metadata?: Record<string, unknown>): string {
    if (!metadata || Object.keys(metadata).length === 0) {
        return 'None';
    }

    return `\n\n\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\``;
}

function buildDelegationMessage(request: DelegationInput): string {
    const sections = [request.task.trim()];

    if (request.context && Object.keys(request.context).length > 0) {
        sections.push(`## Context\n${JSON.stringify(request.context, null, 2)}`);
    }

    if (request.relevantFiles && request.relevantFiles.length > 0) {
        sections.push(`## Relevant Files\n${request.relevantFiles.map(filePath => `- ${filePath}`).join('\n')}`);
    }

    sections.push(
        `## Completion Requirement\nWhen the task is complete, call ${COMPLETION_TOOL_NAME} exactly once with a concise summary and any files you created or modified.`
    );

    return sections.join('\n\n');
}

function buildSubAgentSystemPrompt(subAgent: NormalizedSubAgent): string {
    return `${subAgent.systemPrompt}\n\n## Delegation Contract\n- Complete only the delegated task.\n- You must call ${COMPLETION_TOOL_NAME} when the work is done.\n- After calling ${COMPLETION_TOOL_NAME}, stop. Do not make additional tool calls or continue reasoning.\n- Return concise, actionable summaries. Put file paths in the files array when relevant.`;
}

function buildSuccessArtifactContent(options: {
    agentName: string;
    request: DelegationInput;
    result: DelegationSuccessResult;
    metadata?: Record<string, unknown>;
}): string {
    return `# ${options.agentName} Task Result\n\n## Task\n${options.request.task}\n\n## Summary\n${options.result.summary}\n\n## Files\n${options.result.filesCreated && options.result.filesCreated.length > 0
        ? options.result.filesCreated.map(filePath => `- \`${filePath}\``).join('\n')
        : 'None'}\n\n## Completion\nStructured completion confirmed via ${COMPLETION_TOOL_NAME}.\n\n## Metadata${formatMetadata(options.metadata)}`;
}

function buildErrorArtifactContent(options: {
    agentName: string;
    request: DelegationInput;
    errorCode: DelegationErrorCode;
    summary: string;
    error: string;
    rawText?: string;
}): string {
    return `# ${options.agentName} Task Failure\n\n## Task\n${options.request.task}\n\n## Error Code\n${options.errorCode}\n\n## Summary\n${options.summary}\n\n## Error\n${options.error}\n\n## Raw Output\n${options.rawText?.trim() ? options.rawText : 'None'}`;
}

function hasPostCompletionActivity(rawResult: ExecutionResult['rawResult']): boolean {
    let completionSeen = false;

    for (const step of rawResult.steps ?? []) {
        for (const part of step.content ?? []) {
            const isCompletionPart =
                (part.type === 'tool-call' || part.type === 'tool-result' || part.type === 'tool-error') &&
                part.toolName === COMPLETION_TOOL_NAME;

            if (isCompletionPart) {
                completionSeen = true;
                continue;
            }

            if (!completionSeen) {
                continue;
            }

            if (part.type === 'text' || part.type === 'reasoning') {
                if (part.text.trim().length > 0) {
                    return true;
                }
                continue;
            }

            return true;
        }
    }

    return false;
}

export default class SubAgentPlugin implements Plugin {
    name = 'SubAgentPlugin';
    private writer?: DataStreamWriter;
    private readonly registry: DelegationRegistry;
    private readonly normalizedSubAgents: Map<string, NormalizedSubAgent>;
    private readonly generalPurposeToolNames: Set<string>;

    constructor(
        private readonly subAgents: Map<string, SubAgent>,
        private readonly baseModel: LanguageModel,
        private readonly createBuiltInPluginsForSubagent: BuiltInPluginFactory,
        private readonly getParentCustomTools: () => Record<string, Tool<any, any>>,
        private readonly parentToolsRequiringApproval: ToolsRequiringApprovalConfig = [],
        private readonly workspaceDir: string = 'workspace',
        private readonly cacheTTL: number = 60 * 60 * 1000,
        private readonly maxConcurrentAgents: number = 4,
        private readonly createAgent: AgentFactory = config => new VibeAgent(config)
    ) {
        this.registry = new DelegationRegistry(cacheTTL);
        this.normalizedSubAgents = this.normalizeSubAgents(subAgents);
        this.generalPurposeToolNames = this.buildGeneralPurposeToolNames();
        this.validateNormalizedSubAgents();
    }

    getRegistry(): DelegationRegistry {
        return this.registry;
    }

    getNormalizedSubAgents(): Map<string, NormalizedSubAgent> {
        return new Map(this.normalizedSubAgents);
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.writer = createDataStreamWriter(writer);
    }

    private normalizeSubAgents(subAgents: Map<string, SubAgent>): Map<string, NormalizedSubAgent> {
        const normalized = new Map<string, NormalizedSubAgent>();

        for (const [name, subAgent] of subAgents.entries()) {
            const explicitPlugins = subAgent.plugins ?? subAgent.middleware ?? [];
            const explicitToolsObject = typeof subAgent.tools === 'object' && !Array.isArray(subAgent.tools)
                ? { ...(subAgent.tools as Record<string, Tool<any, any>>) }
                : undefined;
            const declaredToolNames = Array.isArray(subAgent.tools) ? [...subAgent.tools] : undefined;
            const inferredMode = (() => {
                if (subAgent.mode) {
                    return subAgent.mode;
                }
                if (subAgent.inheritPlugins === true) {
                    return 'general-purpose' as const;
                }
                if (declaredToolNames) {
                    return 'general-purpose' as const;
                }
                if ((subAgent.allowedTools || subAgent.blockedTools) && !explicitToolsObject && explicitPlugins.length === 0) {
                    return 'general-purpose' as const;
                }
                return 'custom' as const;
            })();

            const allowedTools = declaredToolNames
                ? Array.from(new Set([...(subAgent.allowedTools ?? []), ...declaredToolNames]))
                : subAgent.allowedTools ? [...subAgent.allowedTools] : undefined;
            const blockedTools = subAgent.blockedTools ? [...subAgent.blockedTools] : undefined;
            const baseFields = {
                name,
                description: subAgent.description,
                systemPrompt: subAgent.systemPrompt,
                model: subAgent.model,
                allowSubdelegation: subAgent.allowSubdelegation ?? false,
                artifactMode: subAgent.artifactMode ?? 'always',
            } satisfies NormalizedSubAgentBase;

            if (inferredMode === 'general-purpose') {
                if (explicitPlugins.length > 0) {
                    throw new DelegationConfigError(`Sub-agent ${name} uses general-purpose mode and cannot define explicit plugins.`);
                }
                if (explicitToolsObject) {
                    throw new DelegationConfigError(`Sub-agent ${name} uses general-purpose mode and cannot define tools as an object.`);
                }

                normalized.set(name, {
                    ...baseFields,
                    mode: 'general-purpose',
                    allowedTools,
                    blockedTools,
                });
                continue;
            }

            if (declaredToolNames && subAgent.mode === 'custom') {
                throw new DelegationConfigError(`Sub-agent ${name} uses custom mode but provided tools as a string array. Use allowedTools for general-purpose mode or an explicit tools object for custom mode.`);
            }

            normalized.set(name, {
                ...baseFields,
                mode: 'custom',
                tools: explicitToolsObject ?? {},
                plugins: [...explicitPlugins],
                allowedTools,
                blockedTools,
                toolsRequiringApproval: subAgent.toolsRequiringApproval ? cloneApprovalConfig(subAgent.toolsRequiringApproval) : undefined,
            });
        }

        return normalized;
    }

    private buildGeneralPurposeToolNames(): Set<string> {
        const toolNames = new Set<string>();
        const plugins = this.createBuiltInPluginsForSubagent({
            model: this.baseModel,
            workspaceDir: this.workspaceDir,
        });

        for (const plugin of plugins) {
            for (const toolName of Object.keys(plugin.tools ?? {})) {
                toolNames.add(toolName);
            }
        }

        for (const toolName of Object.keys(this.getParentCustomTools())) {
            toolNames.add(toolName);
        }

        return toolNames;
    }

    private validateNormalizedSubAgents(): void {
        for (const subAgent of this.normalizedSubAgents.values()) {
            if (subAgent.mode !== 'general-purpose' || !subAgent.allowedTools) {
                continue;
            }

            for (const toolName of subAgent.allowedTools) {
                if (!this.generalPurposeToolNames.has(toolName)) {
                    throw new DelegationConfigError(`Sub-agent ${subAgent.name} references unknown general-purpose tool \"${toolName}\".`);
                }
            }
        }
    }

    private buildCustomToolNames(subAgent: NormalizedCustomSubAgent): Set<string> {
        const toolNames = new Set<string>(Object.keys(subAgent.tools));
        for (const plugin of subAgent.plugins) {
            for (const toolName of Object.keys(plugin.tools ?? {})) {
                toolNames.add(toolName);
            }
        }
        return toolNames;
    }

    private validateAllowedTools(agentName: string, availableToolNames: Set<string>, allowedTools?: string[]): void {
        if (!allowedTools) {
            return;
        }

        for (const toolName of allowedTools) {
            if (toolName === COMPLETION_TOOL_NAME) {
                continue;
            }
            if (!availableToolNames.has(toolName)) {
                throw new DelegationConfigError(`Sub-agent ${agentName} references unknown tool \"${toolName}\".`);
            }
        }
    }

    private buildCompletionTool(tracker: CompletionTracker) {
        return tool({
            description: `Report that the delegated task is complete. Call this exactly once when your work is finished.`,
            inputSchema: completionSchema,
            execute: async (payload) => {
                tracker.callCount += 1;
                if (!tracker.payload) {
                    tracker.payload = {
                        summary: payload.summary,
                        files: payload.files ?? [],
                        metadata: payload.metadata,
                    };
                }

                return {
                    status: 'recorded',
                    completionConfirmed: true,
                };
            },
        });
    }

    private buildAgentConfig(subAgent: NormalizedSubAgent, completionTool: Tool<any, any>): VibeAgentConfig {
        const model = subAgent.model || this.baseModel;
        const blockedTools = mergeBlockedTools(subAgent.blockedTools, subAgent.allowSubdelegation);

        if (subAgent.mode === 'general-purpose') {
            const tools = {
                ...this.getParentCustomTools(),
                [COMPLETION_TOOL_NAME]: completionTool,
            };
            const availableToolNames = new Set<string>([...this.generalPurposeToolNames, COMPLETION_TOOL_NAME]);
            this.validateAllowedTools(subAgent.name, availableToolNames, subAgent.allowedTools);

            const toolsRequiringApproval = filterApprovalConfig(
                cloneApprovalConfig(this.parentToolsRequiringApproval),
                availableToolNames
            );

            return {
                model,
                instructions: buildSubAgentSystemPrompt(subAgent),
                maxSteps: 30,
                stopWhen: hasToolCall(COMPLETION_TOOL_NAME),
                plugins: this.createBuiltInPluginsForSubagent({ model, workspaceDir: this.workspaceDir }),
                tools,
                allowedTools: subAgent.allowedTools
                    ? Array.from(new Set([...subAgent.allowedTools, COMPLETION_TOOL_NAME]))
                    : undefined,
                blockedTools,
                toolsRequiringApproval,
            };
        }

        const availableToolNames = this.buildCustomToolNames(subAgent);
        availableToolNames.add(COMPLETION_TOOL_NAME);
        this.validateAllowedTools(subAgent.name, availableToolNames, subAgent.allowedTools);

        return {
            model,
            instructions: buildSubAgentSystemPrompt(subAgent),
            maxSteps: 30,
            stopWhen: hasToolCall(COMPLETION_TOOL_NAME),
            plugins: [...subAgent.plugins],
            tools: {
                ...subAgent.tools,
                [COMPLETION_TOOL_NAME]: completionTool,
            },
            allowedTools: subAgent.allowedTools
                ? Array.from(new Set([...subAgent.allowedTools, COMPLETION_TOOL_NAME]))
                : undefined,
            blockedTools,
            toolsRequiringApproval: subAgent.toolsRequiringApproval
                ? filterApprovalConfig(cloneApprovalConfig(subAgent.toolsRequiringApproval), availableToolNames)
                : [],
        };
    }

    private async executeSubAgent(subAgent: NormalizedSubAgent, request: DelegationInput): Promise<ExecutionResult> {
        const tracker: CompletionTracker = { callCount: 0, payload: null };
        const agent = this.createAgent(this.buildAgentConfig(subAgent, this.buildCompletionTool(tracker)));
        const rawResult = await agent.generate({
            messages: [{ role: 'user', content: buildDelegationMessage(request) }],
        });

        return {
            rawResult,
            completionPayload: tracker.payload,
        };
    }

    private async writeArtifact(agentName: string, content: string): Promise<string> {
        const workspaceRoot = path.resolve(process.cwd(), this.workspaceDir);
        const resultDir = path.join(workspaceRoot, 'subagent_results');
        await fs.mkdir(resultDir, { recursive: true });

        const fileName = `${sanitizeFileComponent(agentName)}_${Date.now()}.md`;
        const fullPath = path.join(resultDir, fileName);
        await fs.writeFile(fullPath, content, 'utf8');

        return `subagent_results/${fileName}`;
    }

    private shouldWriteArtifact(mode: ArtifactMode, outcome: 'success' | 'error'): boolean {
        if (mode === 'never') {
            return false;
        }
        if (mode === 'always') {
            return true;
        }
        return outcome === 'error';
    }

    private async createErrorResult(options: {
        delegationId: string;
        subAgent: NormalizedSubAgent;
        request: DelegationInput;
        errorCode: DelegationErrorCode;
        summary: string;
        error: string;
        rawText?: string;
    }): Promise<DelegationErrorResult> {
        let savedTo: string | undefined;

        if (this.shouldWriteArtifact(options.subAgent.artifactMode, 'error')) {
            savedTo = await this.writeArtifact(
                options.subAgent.name,
                buildErrorArtifactContent({
                    agentName: options.subAgent.name,
                    request: options.request,
                    errorCode: options.errorCode,
                    summary: options.summary,
                    error: options.error,
                    rawText: options.rawText,
                })
            );
        }

        return {
            status: 'error',
            delegationId: options.delegationId,
            summary: options.summary,
            error: options.error,
            errorCode: options.errorCode,
            savedTo,
        };
    }

    private async runDelegationTask(subAgent: NormalizedSubAgent, request: DelegationInput): Promise<DelegationSuccessResult | DelegationErrorResult> {
        const delegationId = `${sanitizeFileComponent(subAgent.name)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.writer?.writeDelegation(delegationId, subAgent.name, truncateTask(request.task), 'starting');

        const cachedEntry = this.registry.get(subAgent.name, request, this.cacheTTL);
        if (cachedEntry) {
            if (cachedEntry.artifactPath && !existsSync(path.resolve(process.cwd(), this.workspaceDir, cachedEntry.artifactPath))) {
                this.registry.delete(subAgent.name, request);
            } else {
                this.writer?.writeDelegation(delegationId, subAgent.name, truncateTask(request.task), 'complete', {
                    artifactPath: cachedEntry.artifactPath,
                    summary: cachedEntry.summary,
                });
                return {
                    status: 'completed',
                    delegationId,
                    summary: cachedEntry.summary,
                    cached: true,
                    savedTo: cachedEntry.artifactPath,
                    filesCreated: cachedEntry.filesCreated.length > 0 ? cachedEntry.filesCreated : undefined,
                    completionConfirmed: true,
                };
            }
        }

        this.writer?.writeDelegation(delegationId, subAgent.name, truncateTask(request.task), 'in_progress');

        try {
            const execution = await this.executeSubAgent(subAgent, request);

            if (!execution.completionPayload) {
                const failure = await this.createErrorResult({
                    delegationId,
                    subAgent,
                    request,
                    errorCode: 'missing_completion',
                    summary: `${subAgent.name} did not call ${COMPLETION_TOOL_NAME}.`,
                    error: `Delegated task completed without a structured ${COMPLETION_TOOL_NAME} signal.`,
                    rawText: execution.rawResult.text,
                });
                this.writer?.writeDelegation(delegationId, subAgent.name, truncateTask(request.task), 'failed', {
                    artifactPath: failure.savedTo,
                    summary: failure.summary,
                    error: failure.error,
                });
                return failure;
            }

            if (hasPostCompletionActivity(execution.rawResult)) {
                const failure = await this.createErrorResult({
                    delegationId,
                    subAgent,
                    request,
                    errorCode: 'post_completion_activity',
                    summary: `${subAgent.name} continued working after calling ${COMPLETION_TOOL_NAME}.`,
                    error: `Delegated task kept producing output after completion was reported.`,
                    rawText: execution.rawResult.text,
                });
                this.writer?.writeDelegation(delegationId, subAgent.name, truncateTask(request.task), 'failed', {
                    artifactPath: failure.savedTo,
                    summary: failure.summary,
                    error: failure.error,
                });
                return failure;
            }

            const success: DelegationSuccessResult = {
                status: 'completed',
                delegationId,
                summary: execution.completionPayload.summary,
                cached: false,
                filesCreated: execution.completionPayload.files.length > 0 ? execution.completionPayload.files : undefined,
                completionConfirmed: true,
            };

            if (this.shouldWriteArtifact(subAgent.artifactMode, 'success')) {
                success.savedTo = await this.writeArtifact(
                    subAgent.name,
                    buildSuccessArtifactContent({
                        agentName: subAgent.name,
                        request,
                        result: success,
                        metadata: execution.completionPayload.metadata,
                    })
                );
            }

            this.registry.set(subAgent.name, request, {
                delegationId,
                timestamp: Date.now(),
                agentName: subAgent.name,
                summary: success.summary,
                artifactPath: success.savedTo,
                filesCreated: success.filesCreated ?? [],
            });

            this.writer?.writeDelegation(delegationId, subAgent.name, truncateTask(request.task), 'complete', {
                artifactPath: success.savedTo,
                summary: success.summary,
            });
            return success;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorCode: DelegationErrorCode = error instanceof DelegationConfigError ? 'invalid_config' : 'subagent_failed';
            const failure = await this.createErrorResult({
                delegationId,
                subAgent,
                request,
                errorCode,
                summary: `${subAgent.name} failed to complete the delegated task.`,
                error: errorMessage,
            });
            this.writer?.writeDelegation(delegationId, subAgent.name, truncateTask(request.task), 'failed', {
                artifactPath: failure.savedTo,
                summary: failure.summary,
                error: failure.error,
            });
            return failure;
        }
    }

    private async scheduleParallelDelegations(
        tasks: DelegationInput[],
        continueOnError: boolean
    ): Promise<{
        success: boolean;
        total: number;
        completed: number;
        failed: number;
        stoppedEarly: boolean;
        results: ParallelDelegationResult[];
        summary: string;
    }> {
        const results: ParallelDelegationResult[] = new Array(tasks.length);
        let nextIndex = 0;
        let activeCount = 0;
        let stoppedEarly = false;
        let resolveRun!: () => void;
        const done = new Promise<void>(resolve => {
            resolveRun = resolve;
        });

        const maybeFinish = () => {
            if (activeCount === 0 && (nextIndex >= tasks.length || stoppedEarly)) {
                resolveRun();
            }
        };

        const launchMore = () => {
            if (stoppedEarly && !continueOnError) {
                maybeFinish();
                return;
            }

            while (
                activeCount < this.maxConcurrentAgents &&
                nextIndex < tasks.length &&
                (!stoppedEarly || continueOnError)
            ) {
                const taskIndex = nextIndex++;
                const task = tasks[taskIndex];
                const subAgent = this.normalizedSubAgents.get(task.agent_name);

                if (!subAgent) {
                    stoppedEarly = stoppedEarly || !continueOnError;
                    results[taskIndex] = {
                        delegationId: `missing-${taskIndex}`,
                        task: task.task,
                        agentName: task.agent_name,
                        success: false,
                        error: `Sub-agent not found: ${task.agent_name}`,
                        errorCode: 'invalid_config',
                    };
                    continue;
                }

                activeCount += 1;
                void this.runDelegationTask(subAgent, task)
                    .then(result => {
                        results[taskIndex] = result.status === 'completed'
                            ? {
                                delegationId: result.delegationId,
                                task: task.task,
                                agentName: task.agent_name,
                                success: true,
                                result,
                            }
                            : {
                                delegationId: result.delegationId,
                                task: task.task,
                                agentName: task.agent_name,
                                success: false,
                                error: result.error,
                                errorCode: result.errorCode,
                            };

                        if (!continueOnError && result.status === 'error') {
                            stoppedEarly = true;
                        }
                    })
                    .finally(() => {
                        activeCount -= 1;
                        launchMore();
                        maybeFinish();
                    });
            }

            maybeFinish();
        };

        launchMore();
        await done;

        const settledResults = results.filter((result): result is ParallelDelegationResult => result != null);
        const completed = settledResults.filter(result => result.success).length;
        const failed = settledResults.length - completed;
        const summary = `Parallel delegation complete: ${completed}/${settledResults.length} tasks succeeded.`;

        return {
            success: failed === 0,
            total: settledResults.length,
            completed,
            failed,
            stoppedEarly,
            results: settledResults,
            summary,
        };
    }

    get tools() {
        const availableAgents = Array.from(this.normalizedSubAgents.values())
            .map(agent => `- ${agent.name}: ${agent.description}`)
            .join('\n');

        const delegateTool = tool({
            description: `Delegate a focused task to a specialized sub-agent.\n\nAvailable sub-agents:\n${availableAgents}`,
            inputSchema: delegationInputSchema,
            execute: async (input) => {
                const subAgent = this.normalizedSubAgents.get(input.agent_name);
                if (!subAgent) {
                    return {
                        status: 'error',
                        delegationId: `missing-${Date.now()}`,
                        summary: `Unknown sub-agent: ${input.agent_name}`,
                        error: `Sub-agent not found: ${input.agent_name}`,
                        errorCode: 'invalid_config' as const,
                    };
                }

                return this.runDelegationTask(subAgent, input);
            },
        });

        const parallelDelegateTool = tool({
            description: `Delegate multiple independent tasks to sub-agents in parallel.\n\nAvailable sub-agents:\n${availableAgents}`,
            inputSchema: z.object({
                tasks: z.array(delegationInputSchema).min(1).max(10).describe('Tasks to execute in parallel.'),
                continueOnError: z.boolean().default(false).describe('If true, continue scheduling tasks after a failure.'),
            }),
            execute: async ({ tasks, continueOnError }) => {
                const result = await this.scheduleParallelDelegations(tasks, continueOnError);
                this.writer?.writeStatus(result.summary);
                return result;
            },
        });

        return {
            task: delegateTool,
            delegate: delegateTool,
            parallel_delegate: parallelDelegateTool,
        };
    }

    modifySystemPrompt(prompt: string): string {
        const agentList = Array.from(this.normalizedSubAgents.values())
            .map(agent => `- ${agent.name}: ${agent.description}`)
            .join('\n');

        return `${prompt}\n\n## Sub-Agent Delegation\n\nAvailable sub-agents:\n${agentList}\n\nUse \`task()\` or \`delegate()\` for one focused delegation and \`parallel_delegate()\` for independent tasks that can run concurrently.\n\nDelegation contract:\n- Treat the structured delegation result as the primary handoff.\n- Read the saved artifact only when the summary is insufficient or you need audit/debug detail.\n- Do not re-delegate the same task unless the requirements changed materially.\n- A successful delegation returns \`status: \"completed\"\` with \`completionConfirmed: true\`.\n- A failed delegation returns \`status: \"error\"\` with an explicit error code.`;
    }
}
