import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { type LanguageModel, type Tool, type UIMessageStreamWriter, tool } from 'ai';
import z from 'zod';
import {
    VibesUIMessage,
    Plugin,
    PluginStreamContext,
    SubAgent,
    ToolsRequiringApprovalConfig,
    createScopedUIMessageStreamWriter,
    createDataStreamWriter,
    type DataStreamWriter,
} from '../core/types';
import { VibesAgent, type VibesAgentConfig } from '../core/agent/agent';

// Optional structured-handoff tool. Sub-agents are NOT required to call it —
// a normal final answer is a perfectly good result. Calling it just lets a
// sub-agent hand back a clean summary + the files it touched.
const COMPLETION_TOOL_NAME = 'report_result';

/**
 * Reliability backstops every delegated sub-agent runs with. The parent agent's
 * loop detection / budgets don't propagate to child agents, so without these a
 * delegated run is bounded only by maxSteps and can spin on a repeated tool call
 * or overspend within those steps. Scaled below the parent's caps since a single
 * delegated task is narrower in scope.
 */
const SUBAGENT_LOOP_DETECTION = { maxRepeats: 3, window: 6 } as const;
const SUBAGENT_BUDGETS = { maxTotalTokens: 1_000_000, maxToolCalls: 60 } as const;

const DELEGATION_TOOL_NAMES = ['task', 'delegate', 'parallel_delegate', 'create_agent', 'spawn_agent', 'list_agents'] as const;
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
    fresh: z.boolean().optional().describe('Bypass the cache and force a fresh run, even if an identical task was run recently.'),
});

export type CompletionPayload = z.infer<typeof completionSchema>;

type DelegationErrorCode = 'no_output' | 'invalid_config' | 'subagent_failed';
type ArtifactMode = 'always' | 'errors-only' | 'never';

type BuiltInPluginFactory = (options: {
    model?: LanguageModel;
    workspaceDir?: string;
}) => Plugin[];

type AgentFactory = (config: VibesAgentConfig) => VibesAgent;

interface DelegationInput extends z.infer<typeof delegationInputSchema> {}

interface DelegationSuccessResult {
    status: 'completed';
    delegationId: string;
    summary: string;
    cached: boolean;
    /** True when the summary was inferred from the sub-agent's final output rather than a structured report_result call. */
    inferred?: boolean;
    savedTo?: string;
    filesCreated?: string[];
    completionConfirmed: boolean;
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
    maxSteps?: number;
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
    rawText: string;
    /** LoopStep shape from the owned core: tool calls live directly on the step. */
    steps: Array<{ toolCalls?: ReadonlyArray<{ toolName?: string }> }>;
    completionPayload: CompletionPayload | null;
    /** Set when the sub-agent's run ended in an error/abort (so we report the cause, not "no_output"). */
    errorText?: string;
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
        `## When you're done\nFinish by giving a short, direct answer describing what you did and what you found. If you created or modified files, optionally call ${COMPLETION_TOOL_NAME} with a summary and the file list — but a plain final answer is fine.`
    );

    return sections.join('\n\n');
}

function buildSubAgentSystemPrompt(subAgent: NormalizedSubAgent): string {
    return `${subAgent.systemPrompt}\n\n## Delegation Contract\n- Focus only on the delegated task; use your tools to actually do the work.\n- When finished, give a concise final answer summarizing the outcome and any file paths.\n- You MAY call ${COMPLETION_TOOL_NAME} to hand back a structured summary + file list, but it is optional — do not loop or stall waiting to call it.`;
}

function buildSuccessArtifact(options: {
    agentName: string;
    request: DelegationInput;
    /** The sub-agent's complete output — stored in full so the inline result can reference it. */
    fullOutput: string;
    result: DelegationSuccessResult;
    metadata?: Record<string, unknown>;
}): { content: string; resultStartLine: number } {
    const completionLine = options.result.inferred
        ? `Inferred from the sub-agent's final output (no structured ${COMPLETION_TOOL_NAME} call).`
        : `Structured completion confirmed via ${COMPLETION_TOOL_NAME}.`;
    // Everything before the output, so we know which file line the output starts
    // on — that lets the TOC's line ranges point at the real file, not at the
    // output's own 1-based lines.
    const head = `# ${options.agentName} Task Result\n\n## Task\n${options.request.task}\n\n## Result\n`;
    const files = options.result.filesCreated && options.result.filesCreated.length > 0
        ? options.result.filesCreated.map(filePath => `- \`${filePath}\``).join('\n')
        : 'None';
    const tail = `\n\n## Files\n${files}\n\n## Completion\n${completionLine}\n\n## Metadata${formatMetadata(options.metadata)}`;
    return {
        content: head + options.fullOutput + tail,
        resultStartLine: (head.match(/\n/g)?.length ?? 0) + 1,
    };
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

/**
 * How much of a sub-agent's output to INLINE in the result handed to the parent.
 * The full output is always preserved in the saved artifact, so this is only a
 * preview budget — anything past it is one `cat` away (progressive disclosure),
 * never lost. ~8k chars ≈ 2k tokens.
 */
const INLINE_RESULT_CHARS = 8000;

interface TocEntry { title: string; level: number; start: number; end: number; }

/**
 * Build a table of contents from the markdown headers in the sub-agent's output,
 * with line ranges relative to the ARTIFACT FILE (offset by where the output
 * begins in it). Computed in code from the agent's own headers — the model never
 * supplies a line number, so the references can't drift. A section spans to the
 * next header of the same-or-higher level (so a `##` includes its `###`
 * children). Headers inside fenced code blocks are ignored. Returns [] when the
 * output isn't meaningfully sectioned.
 */
function buildToc(fullText: string, resultStartLine: number): TocEntry[] {
    const lines = fullText.split('\n');
    const headers: { level: number; title: string; line: number }[] = [];
    let inFence = false;
    lines.forEach((ln, i) => {
        if (/^\s*```/.test(ln)) { inFence = !inFence; return; }
        if (inFence) return;
        const m = /^(#{1,3})\s+(.+?)\s*$/.exec(ln);
        if (m) headers.push({ level: m[1].length, title: m[2], line: i + 1 });
    });
    if (headers.length < 2) return [];
    const lastLine = lines.length;
    return headers.map((h, idx) => {
        let end = lastLine;
        for (let j = idx + 1; j < headers.length; j++) {
            if (headers[j].level <= h.level) { end = headers[j].line - 1; break; }
        }
        return {
            title: h.title,
            level: h.level,
            start: resultStartLine + h.line - 1,
            end: resultStartLine + end - 1,
        };
    });
}

/**
 * The result handed to the parent. The whole output when it fits; otherwise — if
 * the output is sectioned and saved — a short lead-in plus a navigable table of
 * contents with line ranges, so the parent jumps to the part it needs
 * (`sed -n 'A,Bp' <file>`) instead of reading everything or re-delegating. Falls
 * back to a flat preview for unsectioned output. No data is ever dropped.
 */
function buildInlineResult(fullText: string, savedTo?: string, resultStartLine?: number): string {
    const trimmed = fullText.trim();
    if (trimmed.length <= INLINE_RESULT_CHARS) return trimmed;

    const toc = savedTo && resultStartLine != null ? buildToc(fullText, resultStartLine) : [];
    if (toc.length >= 2) {
        const minLevel = Math.min(...toc.map((s) => s.level));
        const entries = toc
            .map((s) => `${'  '.repeat(s.level - minLevel)}- ${s.title} — lines ${s.start}–${s.end}`)
            .join('\n');
        // Lead-in: the output's preamble before its first header, capped.
        const headerIdx = trimmed.search(/^#{1,3}\s/m);
        const leadRaw = (headerIdx > 0 ? trimmed.slice(0, headerIdx) : '').trim();
        const lead = leadRaw.length > 600 ? `${leadRaw.slice(0, 600).trimEnd()}…` : leadRaw;
        return `${lead ? `${lead}\n\n` : ''}This result is long (${trimmed.length} chars). The full output is saved to \`${savedTo}\` — read a section with \`sed -n 'START,ENDp' ${savedTo}\`:\n\n${entries}`;
    }

    // Unsectioned (or no saved file): flat preview + pointer.
    const preview = trimmed.slice(0, INLINE_RESULT_CHARS).trimEnd();
    const more = trimmed.length - INLINE_RESULT_CHARS;
    const pointer = savedTo
        ? ` The complete result is saved to \`${savedTo}\` — read it (\`cat ${savedTo}\`) if you need the rest.`
        : '';
    return `${preview}\n\n[… ${more} more characters not shown.${pointer}]`;
}

/**
 * Last-resort summary when a sub-agent did real work (tool calls) but produced
 * no final text and no structured report — describe what it ran so the result
 * isn't an empty string.
 */
function summarizeFromSteps(steps: ExecutionResult['steps']): string {
    const tools = new Set<string>();
    for (const step of steps ?? []) {
        for (const call of step.toolCalls ?? []) {
            if (call.toolName && call.toolName !== COMPLETION_TOOL_NAME) {
                tools.add(call.toolName);
            }
        }
    }
    return tools.size > 0
        ? `Completed the task using: ${Array.from(tools).join(', ')}.`
        : '';
}

export default class SubAgentPlugin implements Plugin {
    name = 'SubAgentPlugin';
    private writer?: DataStreamWriter;
    private streamContext?: PluginStreamContext;
    private readonly registry: DelegationRegistry;
    private normalizedSubAgents: Map<string, NormalizedSubAgent>;
    private readonly generalPurposeToolNames: Set<string>;
    /**
     * The parent agent's context window + compression ratio, so a delegated
     * sub-agent's own gauge is framed against the right model. Seeded by the
     * parent through `setContextWindow` (the AgentHarness fan-out) and refreshed
     * when the UI swaps models mid-session.
     */
    private parentContextWindow = 128_000;
    private parentCompressionRatio = 0.7;

    constructor(
        private readonly subAgents: Map<string, SubAgent>,
        private readonly baseModel: LanguageModel,
        private readonly createBuiltInPluginsForSubagent: BuiltInPluginFactory,
        private readonly getParentCustomTools: () => Record<string, Tool<any, any>>,
        private readonly parentToolsRequiringApproval: ToolsRequiringApprovalConfig = [],
        private readonly workspaceDir: string = 'workspace',
        private readonly cacheTTL: number = 60 * 60 * 1000,
        private readonly maxConcurrentAgents: number = 4,
        private readonly createAgent: AgentFactory = config => new VibesAgent(config)
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

    onStreamContextReady(context: PluginStreamContext) {
        this.streamContext = context;
        this.writer = context.writer.withDefaults({ plugin: this.name });
    }

    /**
     * Receive the parent's context window/ratio (via AgentHarness's fan-out) so
     * delegated sub-agents render their own gauge against the same frame.
     */
    setContextWindow(contextWindow: number, compressionRatio?: number): void {
        if (Number.isFinite(contextWindow) && contextWindow > 0) {
            this.parentContextWindow = contextWindow;
        }
        if (compressionRatio !== undefined && compressionRatio > 0 && compressionRatio <= 1) {
            this.parentCompressionRatio = compressionRatio;
        }
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
                maxSteps: subAgent.maxSteps,
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

            const unknown = subAgent.allowedTools.filter(
                toolName => toolName !== COMPLETION_TOOL_NAME && !this.generalPurposeToolNames.has(toolName)
            );
            if (unknown.length > 0) {
                // Don't crash the whole agent over a typo'd tool name — the
                // unknown tools simply won't be available to the sub-agent.
                console.warn(`[SubAgentPlugin] Sub-agent "${subAgent.name}" references unknown tool(s): ${unknown.join(', ')}. They will be ignored.`);
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

        const unknown = allowedTools.filter(
            toolName => toolName !== COMPLETION_TOOL_NAME && !availableToolNames.has(toolName)
        );
        if (unknown.length > 0) {
            console.warn(`[SubAgentPlugin] Sub-agent "${agentName}" references unknown tool(s): ${unknown.join(', ')}. They will be ignored.`);
        }
    }

    /** Split requested tool names into the ones we can provide and the rest. */
    private partitionTools(allowedTools?: string[]): { available: string[]; unknown: string[] } {
        if (!allowedTools) return { available: Array.from(this.generalPurposeToolNames), unknown: [] };
        const available: string[] = [];
        const unknown: string[] = [];
        for (const toolName of allowedTools) {
            (this.generalPurposeToolNames.has(toolName) ? available : unknown).push(toolName);
        }
        return { available, unknown };
    }

    /**
     * Register a sub-agent defined at runtime by the parent agent. Dynamic
     * agents are always general-purpose (lean plugin set + a tool whitelist).
     */
    registerDynamicAgent(spec: {
        name: string;
        description: string;
        systemPrompt: string;
        allowedTools?: string[];
        allowSubdelegation?: boolean;
        maxSteps?: number;
        artifactMode?: ArtifactMode;
    }): NormalizedGeneralPurposeSubAgent {
        const normalized: NormalizedGeneralPurposeSubAgent = {
            name: spec.name,
            description: spec.description,
            systemPrompt: spec.systemPrompt,
            model: undefined,
            allowSubdelegation: spec.allowSubdelegation ?? false,
            artifactMode: spec.artifactMode ?? 'errors-only',
            maxSteps: spec.maxSteps,
            mode: 'general-purpose',
            allowedTools: spec.allowedTools,
            blockedTools: undefined,
        };
        this.normalizedSubAgents.set(spec.name, normalized);
        return normalized;
    }

    private buildCompletionTool(tracker: CompletionTracker) {
        return tool({
            description: `Optional: hand back a structured summary of the completed task plus the files you created or modified. Not required — a normal final answer also works. Call at most once.`,
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

    private buildAgentConfig(subAgent: NormalizedSubAgent, completionTool: Tool<any, any>): VibesAgentConfig {
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
                // Run the normal agent loop; the model stops when it gives a
                // final answer. maxSteps caps step count; loopDetection + budgets
                // catch a spinning or runaway delegated run within those steps.
                maxSteps: subAgent.maxSteps ?? 25,
                loopDetection: SUBAGENT_LOOP_DETECTION,
                budgets: SUBAGENT_BUDGETS,
                plugins: this.createBuiltInPluginsForSubagent({ model, workspaceDir: this.workspaceDir }),
                tools,
                allowedTools: subAgent.allowedTools
                    ? Array.from(new Set([...subAgent.allowedTools, COMPLETION_TOOL_NAME]))
                    : undefined,
                blockedTools,
                toolsRequiringApproval,
                // A delegated sub-agent emits its OWN gauge. The scoped writer
                // tags it with this agent's delegationId, so the UI shows it
                // separately (under the sub-agent's tab) instead of clobbering
                // the main conversation's gauge.
                contextWindow: this.parentContextWindow,
                contextCompressionRatio: this.parentCompressionRatio,
            };
        }

        const availableToolNames = this.buildCustomToolNames(subAgent);
        availableToolNames.add(COMPLETION_TOOL_NAME);
        this.validateAllowedTools(subAgent.name, availableToolNames, subAgent.allowedTools);

        return {
            model,
            instructions: buildSubAgentSystemPrompt(subAgent),
            maxSteps: subAgent.maxSteps ?? 25,
            loopDetection: SUBAGENT_LOOP_DETECTION,
            budgets: SUBAGENT_BUDGETS,
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
            // A delegated sub-agent emits its OWN gauge, tagged with this
            // agent's delegationId so the UI shows it separately rather than
            // overwriting the main conversation's gauge.
            contextWindow: this.parentContextWindow,
            contextCompressionRatio: this.parentCompressionRatio,
        };
    }

    private async executeSubAgent(
        subAgent: NormalizedSubAgent,
        request: DelegationInput,
        writer?: UIMessageStreamWriter<VibesUIMessage>,
        abortSignal?: AbortSignal
    ): Promise<ExecutionResult> {
        const tracker: CompletionTracker = { callCount: 0, payload: null };
        const agent = this.createAgent(this.buildAgentConfig(subAgent, this.buildCompletionTool(tracker)));
        const rawResult: any = await agent.stream({
            messages: [{ role: 'user', content: buildDelegationMessage(request) }],
            ...(writer ? { writer } : {}),
            // Propagate the parent's abort so stopping the top-level run also
            // cancels in-flight sub-agents instead of leaving them running.
            ...(abortSignal ? { abortSignal } : {}),
        });

        // Forward the sub-agent's LIVE thinking + narration to the parent stream
        // (via the delegation-scoped writer, which tags everything with this
        // agent's delegationId/agentName) so the UI can show what it's actually
        // doing under its tab — not just lifecycle dots. Best-effort and only
        // when a real stream is present; mock results have no `fullStream`.
        let liveText = '';
        let liveReasoning = '';
        const consumedFullStream = !!(writer && rawResult?.fullStream?.[Symbol.asyncIterator]);
        if (consumedFullStream) {
            let lastEmit = 0;
            const flush = (text: string, reasoning: boolean, force = false) => {
                const now = Date.now();
                if (!force && now - lastEmit < 60) return; // throttle high-frequency deltas
                lastEmit = now;
                writer!.write({
                    type: reasoning ? 'data-agent_thought' : 'data-agent_message',
                    id: reasoning ? 'agent-thought' : 'agent-message',
                    data: { text },
                } as any);
            };
            try {
                for await (const part of rawResult.fullStream) {
                    const piece = typeof part?.text === 'string' ? part.text : '';
                    if (part?.type === 'text-delta' && piece) {
                        liveText += piece;
                        flush(liveText, false);
                    } else if (part?.type === 'reasoning-delta' && piece) {
                        liveReasoning += piece;
                        flush(liveReasoning, true);
                    }
                }
            } catch {
                // Forwarding is best-effort; the resolved result below is authoritative.
            }
            if (liveText) flush(liveText, false, true);
            if (liveReasoning) flush(liveReasoning, true, true);
        }

        const [rawText, steps] = await Promise.all([
            // When we drained fullStream ourselves, `liveText` is the answer; don't
            // also await `.text` (avoids any second-consumption edge cases).
            consumedFullStream ? Promise.resolve(liveText) : Promise.resolve(rawResult.text),
            rawResult.steps,
            rawResult.response,
        ]).then(([text, resolvedSteps]) => [text, resolvedSteps] as const);

        // Surface a swallowed provider/stream error (e.g. a rate limit) so a
        // failed run reports its real cause instead of a generic "no_output".
        // `stopReason`/`errorText` are absent on mock results — guard for undefined.
        const stopReason = await Promise.resolve(rawResult.stopReason).catch(() => undefined);
        const errorText = await Promise.resolve(rawResult.errorText).catch(() => undefined);

        return {
            rawText,
            steps,
            completionPayload: tracker.payload,
            ...(errorText || stopReason === 'error' || stopReason === 'aborted'
                ? { errorText: errorText || `sub-agent run ${stopReason}` }
                : {}),
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

    private async runDelegationTask(subAgent: NormalizedSubAgent, request: DelegationInput, abortSignal?: AbortSignal): Promise<DelegationSuccessResult | DelegationErrorResult> {
        const delegationId = `${sanitizeFileComponent(subAgent.name)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const delegationOperation = this.streamContext?.createOperation({
            name: `delegation-${subAgent.name}`,
            toolName: 'delegate',
            plugin: this.name,
            delegationId,
            agentName: subAgent.name,
        });
        const truncatedTask = truncateTask(request.task);
        this.writer?.writeDelegation(delegationId, subAgent.name, truncatedTask, 'starting');
        delegationOperation?.milestone(`Starting delegated task for ${subAgent.name}`, { phase: 'start' });

        // Child-scoped streaming, created once and reused by the success and
        // failure paths (so the catch block no longer re-creates it).
        const scopedWriter = this.streamContext
            ? createScopedUIMessageStreamWriter(this.streamContext.rawWriter, {
                defaults: {
                    agentName: subAgent.name,
                    delegationId,
                    parentOperationId: delegationOperation?.operationId,
                },
                idPrefix: `${delegationId}:`,
            })
            : undefined;
        const childStreamOperation = scopedWriter
            ? createDataStreamWriter(scopedWriter)
                .withDefaults({
                    plugin: this.name,
                    agentName: subAgent.name,
                    delegationId,
                    parentOperationId: delegationOperation?.operationId,
                })
                .createOperation({
                    name: `delegated-${subAgent.name}`,
                    toolName: 'subagent',
                    plugin: this.name,
                    agentName: subAgent.name,
                    delegationId,
                    parentOperationId: delegationOperation?.operationId,
                })
            : undefined;

        const emitFailure = (failure: DelegationErrorResult): void => {
            this.writer?.writeDelegation(delegationId, subAgent.name, truncatedTask, 'failed', {
                artifactPath: failure.savedTo,
                summary: failure.summary,
                error: failure.error,
            });
            delegationOperation?.fail(failure.error, { toolName: 'delegate', phase: 'failed', context: failure.errorCode });
            childStreamOperation?.fail(failure.error, { toolName: 'subagent', phase: 'failed', context: failure.errorCode });
        };

        // Cache lookup — skipped when the caller asked for a fresh run.
        if (!request.fresh) {
            const cachedEntry = this.registry.get(subAgent.name, request, this.cacheTTL);
            if (cachedEntry) {
                if (cachedEntry.artifactPath && !existsSync(path.resolve(process.cwd(), this.workspaceDir, cachedEntry.artifactPath))) {
                    this.registry.delete(subAgent.name, request);
                } else {
                    this.writer?.writeDelegation(delegationId, subAgent.name, truncatedTask, 'complete', {
                        artifactPath: cachedEntry.artifactPath,
                        summary: cachedEntry.summary,
                        cached: true,
                    });
                    delegationOperation?.complete(`Used cached delegation result from ${subAgent.name}`, { phase: 'cache' });
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
        }

        this.writer?.writeDelegation(delegationId, subAgent.name, truncatedTask, 'in_progress');
        delegationOperation?.milestone(`Streaming delegated work from ${subAgent.name}`, { phase: 'stream' });
        childStreamOperation?.progress('starting', { phase: 'start', message: `${subAgent.name} started delegated work` });
        childStreamOperation?.milestone(`Delegated work is active in ${subAgent.name}`, { phase: 'stream' });

        try {
            const execution = await this.executeSubAgent(subAgent, request, scopedWriter, abortSignal);
            const completion = execution.completionPayload;
            const finalText = execution.rawText?.trim() ?? '';
            const stepSummary = summarizeFromSteps(execution.steps);

            // The result is whatever the sub-agent gave back, in order of
            // richness: a structured report → its final answer → a description
            // of the tools it ran. A delegation only FAILS when it threw (catch
            // below) or produced literally nothing of any kind. No more failing
            // a finished task just because it skipped the report tool.
            const resolvedSummary = completion?.summary || finalText || stepSummary;
            if (!resolvedSummary) {
                const failure = await this.createErrorResult({
                    delegationId,
                    subAgent,
                    request,
                    // If the run actually errored (swallowed provider/stream error),
                    // report the real cause; only fall back to no_output for a
                    // genuinely empty-but-successful run.
                    errorCode: execution.errorText ? 'subagent_failed' : 'no_output',
                    summary: execution.errorText
                        ? `${subAgent.name} failed: ${execution.errorText}`
                        : `${subAgent.name} finished without producing any output.`,
                    error: execution.errorText
                        ?? `The sub-agent ran but returned no answer, no report, and took no actions.`,
                    rawText: execution.rawText,
                });
                emitFailure(failure);
                return failure;
            }

            const inferred = !completion;
            // The sub-agent's complete deliverable (report summary → final answer
            // → description of what it ran).
            const fullText = resolvedSummary;
            const success: DelegationSuccessResult = {
                status: 'completed',
                delegationId,
                summary: '', // finalized after we know whether/where the full output was saved
                cached: false,
                inferred: inferred || undefined,
                filesCreated: completion?.files.length ? completion.files : undefined,
                completionConfirmed: !inferred,
            };

            // Progressive disclosure: when the output is too long to inline, ALWAYS
            // persist the full text (on top of the agent's artifactMode) so the
            // preview can point at it — nothing is dropped, and the parent can read
            // the rest on demand instead of re-delegating.
            const willTruncate = fullText.trim().length > INLINE_RESULT_CHARS;
            let resultStartLine: number | undefined;
            if (willTruncate || this.shouldWriteArtifact(subAgent.artifactMode, 'success')) {
                const artifact = buildSuccessArtifact({
                    agentName: subAgent.name,
                    request,
                    fullOutput: fullText,
                    result: success,
                    metadata: completion?.metadata,
                });
                resultStartLine = artifact.resultStartLine;
                success.savedTo = await this.writeArtifact(subAgent.name, artifact.content);
            }

            success.summary = buildInlineResult(fullText, success.savedTo, resultStartLine);

            this.registry.set(subAgent.name, request, {
                delegationId,
                timestamp: Date.now(),
                agentName: subAgent.name,
                summary: success.summary,
                artifactPath: success.savedTo,
                filesCreated: success.filesCreated ?? [],
            });

            this.writer?.writeDelegation(delegationId, subAgent.name, truncatedTask, 'complete', {
                artifactPath: success.savedTo,
                summary: success.summary,
                inferred: inferred || undefined,
            });
            delegationOperation?.complete(`Delegation completed: ${success.summary}`, { phase: 'complete' });
            childStreamOperation?.complete(`Delegated work completed in ${subAgent.name}`, { phase: 'complete' });
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
            emitFailure(failure);
            return failure;
        }
    }

    private async scheduleParallelDelegations(
        tasks: DelegationInput[],
        continueOnError: boolean,
        abortSignal?: AbortSignal
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
                void this.runDelegationTask(subAgent, task, abortSignal)
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

    private describeAgents(): string {
        return Array.from(this.normalizedSubAgents.values())
            .map(agent => `- ${agent.name}: ${agent.description}`)
            .join('\n');
    }

    get tools(): Record<string, import("ai").Tool> {
        const toolHint = `\n\nAvailable tools for sub-agents: ${Array.from(this.generalPurposeToolNames).join(', ')}.`;

        const delegateTool = tool({
            description: `Delegate a focused task to a sub-agent (built-in or one you created). Call list_agents to see who's available, or create_agent / spawn_agent to deploy a new specialist.`,
            inputSchema: delegationInputSchema,
            execute: async (input, options) => {
                const subAgent = this.normalizedSubAgents.get(input.agent_name);
                if (!subAgent) {
                    return {
                        status: 'error',
                        delegationId: `missing-${Date.now()}`,
                        summary: `Unknown sub-agent: ${input.agent_name}`,
                        error: `Sub-agent not found: ${input.agent_name}. Call list_agents to see available agents, or create_agent to make one.`,
                        errorCode: 'invalid_config' as const,
                    };
                }

                return this.runDelegationTask(subAgent, input, options?.abortSignal);
            },
        });

        const parallelDelegateTool = tool({
            description: `Delegate multiple independent tasks to sub-agents in parallel. Each task names an existing agent (see list_agents).`,
            inputSchema: z.object({
                tasks: z.array(delegationInputSchema).min(1).max(10).describe('Tasks to execute in parallel.'),
                continueOnError: z.boolean().default(false).describe('If true, continue scheduling tasks after a failure.'),
            }),
            execute: async ({ tasks, continueOnError }, options) => {
                const result = await this.scheduleParallelDelegations(tasks, continueOnError, options?.abortSignal);
                this.writer?.writeStatus(result.summary);
                return result;
            },
        });

        const createAgentTool = tool({
            description: `Define a NEW sub-agent at runtime that you can then delegate to. Use this to deploy a specialist tailored to the task instead of relying only on the built-in roster.${toolHint}`,
            inputSchema: z.object({
                name: z.string().describe('Unique short name, e.g. "MigrationWriter".'),
                description: z.string().describe('What this agent specializes in (shown in list_agents).'),
                system_prompt: z.string().describe('The persona and operating rules for the sub-agent.'),
                allowed_tools: z.array(z.string()).optional().describe('Tools the agent may use. Omit to allow all available tools.'),
                allow_subdelegation: z.boolean().optional().describe('Whether this agent may itself delegate further (default false).'),
            }),
            execute: async (input) => {
                const { available, unknown } = this.partitionTools(input.allowed_tools);
                this.registerDynamicAgent({
                    name: input.name,
                    description: input.description,
                    systemPrompt: input.system_prompt,
                    allowedTools: input.allowed_tools,
                    allowSubdelegation: input.allow_subdelegation,
                });
                this.writer?.writeStatus(`Created sub-agent "${input.name}"`, undefined, undefined, { transient: true });
                return {
                    ok: true,
                    name: input.name,
                    availableTools: available,
                    ignoredUnknownTools: unknown.length ? unknown : undefined,
                    message: `Sub-agent "${input.name}" is ready. Delegate with task(agent_name: "${input.name}", task: "…").`,
                };
            },
        });

        const spawnAgentTool = tool({
            description: `Define AND run a one-off sub-agent in a single call — for quick specialist work you don't need to reuse.${toolHint}`,
            inputSchema: z.object({
                task: z.string().describe('The task for the spawned agent.'),
                system_prompt: z.string().describe('Persona / instructions for the spawned agent.'),
                allowed_tools: z.array(z.string()).optional().describe('Tools it may use. Omit to allow all available tools.'),
                name: z.string().optional().describe('Optional name to reuse it later; otherwise an ephemeral one is generated.'),
                context: z.record(z.string(), z.unknown()).optional(),
                relevant_files: z.array(z.string()).optional(),
            }),
            execute: async (input, options) => {
                const name = input.name ?? `spawned-${Date.now().toString(36)}`;
                const subAgent = this.registerDynamicAgent({
                    name,
                    description: `Spawned for: ${truncateTask(input.task)}`,
                    systemPrompt: input.system_prompt,
                    allowedTools: input.allowed_tools,
                });
                return this.runDelegationTask(
                    subAgent,
                    { agent_name: name, task: input.task, context: input.context, relevantFiles: input.relevant_files, fresh: true },
                    options?.abortSignal,
                );
            },
        });

        const listAgentsTool = tool({
            description: `List the sub-agents available for delegation (built-in and ones you created at runtime).`,
            inputSchema: z.object({}),
            execute: async () => ({
                agents: Array.from(this.normalizedSubAgents.values()).map(agent => ({
                    name: agent.name,
                    description: agent.description,
                    tools: agent.mode === 'general-purpose' ? (agent.allowedTools ?? 'all') : 'custom',
                })),
            }),
        });

        return {
            task: delegateTool,
            delegate: delegateTool,
            parallel_delegate: parallelDelegateTool,
            create_agent: createAgentTool,
            spawn_agent: spawnAgentTool,
            list_agents: listAgentsTool,
        };
    }

    modifySystemPrompt(prompt: string): string {
        return `${prompt}\n\n## Sub-Agent Delegation\n\nYou can offload focused work to sub-agents — lean workers with their own tools that report back a result. Built-in sub-agents:\n${this.describeAgents()}\n\nHow to use them:\n- \`task()\` / \`delegate()\` — run one focused task on a named agent.\n- \`parallel_delegate()\` — run several independent tasks at once.\n- \`create_agent()\` — define a NEW specialist on the fly (name, description, system prompt, allowed tools), then delegate to it. You are not limited to the built-in roster.\n- \`spawn_agent()\` — define AND run a one-off agent in a single call.\n- \`list_agents()\` — see everyone currently available.\n\nGuidance:\n- Delegate genuinely separable work (research, a self-contained file/module, parallel investigations). Keep the orchestration and final synthesis yourself.\n- A successful delegation returns \`status: "completed"\` with a \`summary\`; a failed one returns \`status: "error"\` with an error code and any partial output.\n- Treat the returned summary as the handoff; only read the saved artifact (under \`subagent_results/\` in your workspace) for audit/debug detail.\n- If parallel results touch the same file, resolve the merge yourself — don't let the last write win.\n- Don't re-delegate an identical task unless requirements changed.`;
    }
}
