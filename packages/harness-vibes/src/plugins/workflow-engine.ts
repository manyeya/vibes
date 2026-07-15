import { streamText, type LanguageModel, type ModelMessage } from 'ai';
import * as path from 'path';
import type { DataStreamWriter } from '../core/types';
import type { Sandbox } from '../core/sandbox';
import { LocalSandbox } from '../sandbox/local-sandbox';
import {
    EXT_BY_KIND as ARTIFACT_EXT_BY_KIND,
    KIND_BY_EXT as ARTIFACT_KIND_BY_EXT,
    slugify as slugifyArtifact,
    validateChartSpec,
    type ArtifactKind,
} from './artifact';
import { reasoningProviderOptions, type ReasoningTier } from '../core/agent/reasoning';

/**
 * Low-level workflow engine — a small executor for the AI SDK's documented
 * agent workflow patterns (https://ai-sdk.dev/docs/agents/workflows):
 * sequential chains, routing, parallelization, orchestrator-worker, and
 * evaluator-optimizer, plus sub-workflow composition.
 *
 * A {@link Workflow} is a declarative graph of typed steps. The engine walks it
 * making REAL model calls (`generateText`), flowing each step's output into a
 * shared context that later steps interpolate via `{{input.x}}` and
 * `{{steps.id}}` templates. Steps that need structured output instruct the model
 * to emit JSON in the prompt and parse it leniently (provider-agnostic — see
 * `callModel`/`jsonInstruction`), rather than the SDK's `experimental_output`,
 * which throws on models without native structured-output support. Definitions
 * are plain JSON, so they persist and re-run trivially (see WorkflowPlugin).
 */

// ── Step / workflow types ────────────────────────────────────────────────────

export type StepKind =
    | 'prompt'
    | 'route'
    | 'parallel'
    | 'orchestrator'
    | 'evaluator'
    | 'pipeline'
    | 'workflow'
    | 'action';

interface StepBase {
    /** Unique id within the workflow — addressable as `{{steps.<id>}}`. */
    id: string;
    kind: StepKind;
    /** Optional short label for the activity feed. */
    title?: string;
}

/** A single model call. The atomic unit; ordered prompt steps form a chain. */
export interface PromptStep extends StepBase {
    kind: 'prompt';
    system?: string;
    /** Prompt text; supports `{{input.x}}` / `{{steps.id}}` interpolation. */
    prompt: string;
    /** Optional JSON schema → structured output via the AI SDK `jsonSchema()`. */
    schema?: Record<string, any>;
    temperature?: number;
}

/** Classify the input, then run the matching branch (Routing). */
export interface RouteStep extends StepBase {
    kind: 'route';
    /** What to classify. */
    prompt: string;
    classifySystem?: string;
    /** `when` labels form the classifier's enum; the chosen branch runs. */
    routes: Array<{ when: string; step: WorkflowStep }>;
}

/** Run independent branches concurrently, optionally synthesize (Parallel). */
export interface ParallelStep extends StepBase {
    kind: 'parallel';
    branches: WorkflowStep[];
    /** Optional synthesis (any step kind); reference each branch via `{{steps.<branchId>}}`. */
    aggregate?: WorkflowStep;
}

/** Plan subtasks, run them as workers, then synthesize (Orchestrator-Worker). */
export interface OrchestratorStep extends StepBase {
    kind: 'orchestrator';
    objective: string;
    workerSystem?: string;
    /** Optional synthesis (any step kind); reference workers via `{{steps.<id>.workers}}`. */
    synthesize?: WorkflowStep;
}

/** Generate → evaluate → retry until good enough (Evaluator-Optimizer). */
export interface EvaluatorStep extends StepBase {
    kind: 'evaluator';
    /**
     * The thing being optimized — any step kind (a prompt, or a composite like a
     * `pipeline`/`orchestrator`). Reference the latest critique via `{{feedback}}`
     * inside it; a plain `prompt` generate also has the feedback auto-appended.
     */
    generate: WorkflowStep;
    /** What "good" means; fed to the evaluator. */
    criteria: string;
    /** Score 1-10 at/above which the loop stops (default 8). */
    threshold?: number;
    /** Hard cap on generate→evaluate iterations (default 3). */
    maxIterations?: number;
}

/** Run a sequence of mixed-pattern steps in order (composition / hybrid). */
export interface PipelineStep extends StepBase {
    kind: 'pipeline';
    /** Sub-steps run in order in the shared context; the last one's output is the result. */
    steps: WorkflowStep[];
}

/** Invoke another saved workflow as a step (composition / reuse). */
export interface SubWorkflowStep extends StepBase {
    kind: 'workflow';
    workflowName: string;
    /** Values/templates mapped into the target workflow's declared inputs. */
    inputs?: Record<string, string>;
}

/** Side-effecting actions an action step can trigger (no model call). */
export type ActionKind = 'create_artifact' | 'update_artifact' | 'write_file';

/**
 * Perform a side-effect — render a canvas artifact or write a workspace file —
 * instead of calling the model. Param string values interpolate `{{input.x}}`,
 * `{{steps.id}}`, and `{{feedback}}` like any other step, so an action turns a
 * previous step's output into a deliverable (e.g. `content: "{{steps.draft}}"`).
 */
export interface ActionStep extends StepBase {
    kind: 'action';
    /** Which side-effect to perform. */
    action: ActionKind;
    /**
     * Action parameters, by name. Values are templates (interpolated before use):
     * - `create_artifact`: title, kind (html|markdown|mermaid|chart), content, summary?
     * - `update_artifact`: id, content, title?, summary?
     * - `write_file`: path, content
     */
    params: Record<string, string>;
}

export type WorkflowStep =
    | PromptStep
    | RouteStep
    | ParallelStep
    | OrchestratorStep
    | EvaluatorStep
    | PipelineStep
    | SubWorkflowStep
    | ActionStep;

/** One tracked artifact within a run (so a later update_artifact finds it). */
interface ArtifactRef {
    id: string;
    title: string;
    kind: ArtifactKind;
    path: string;
    version: number;
    summary?: string;
}

export type WorkflowInputType = 'string' | 'number' | 'boolean' | 'array' | 'json';

export interface WorkflowInput {
    name: string;
    description?: string;
    required?: boolean;
    /** Value type (default 'string'). Provided values + the default are coerced to it. */
    type?: WorkflowInputType;
    /** For a `string` input, the allowed values. */
    enum?: string[];
    default?: string | number | boolean;
}

export interface Workflow {
    id: string;
    name: string;
    /** Optional short alias for invoking it (e.g. "aww" → `/aww`). */
    slug?: string;
    description: string;
    tags: string[];
    inputs: WorkflowInput[];
    /** Executed in order; outputs accumulate in the run context. */
    steps: WorkflowStep[];
    createdAt: string;
    updatedAt: string;
    version: number;
}

// ── Run result / handles ─────────────────────────────────────────────────────

export interface WorkflowTraceEntry {
    stepId: string;
    kind: StepKind;
    status: 'complete' | 'failed';
    summary: string;
}

export interface WorkflowRunResult {
    success: boolean;
    finalOutput: unknown;
    trace: WorkflowTraceEntry[];
    /** Total model calls made — surfaced for cost awareness. */
    modelCalls: number;
    error?: string;
}

export interface WorkflowEngineOptions {
    /** Per-run model-call budget (default 25). */
    maxModelCalls?: number;
    /** Sub-workflow recursion depth limit (default 3). */
    maxDepth?: number;
    /**
     * Max output tokens per model call (default 4096). Bounds per-step latency —
     * workflow steps produce focused outputs, not essays. Raise for steps that
     * legitimately generate long documents.
     */
    maxOutputTokens?: number;
    /**
     * Reasoning effort for workflow steps (default 'low'). Steps are mechanical,
     * so full chain-of-thought is mostly wasted latency; low effort is faster and
     * leaves more of the output budget for the actual answer. Provider keys are
     * namespaced and ignored by models without reasoning.
     */
    reasoningEffort?: ReasoningTier;
}

export interface WorkflowRunHandles {
    /** Scoped writer for `data-workflow` progress (optional). */
    writer?: DataStreamWriter;
    abortSignal?: AbortSignal;
    /** Resolve a saved workflow by name, for `workflow` (sub-workflow) steps. */
    resolveWorkflow?: (name: string) => Workflow | undefined;
    /** Filesystem for `action` steps (artifacts / file writes). Defaults to a LocalSandbox. */
    sandbox?: Sandbox;
    /** Sandbox-relative directory canvas artifacts are written to (default `artifacts`). */
    artifactsDir?: string;
}

// ── Internal run state ───────────────────────────────────────────────────────

/** One step's live execution state, accumulated for the UI snapshot. */
interface StepProgress {
    id: string;
    kind: StepKind;
    title?: string;
    status: 'running' | 'complete' | 'failed';
    depth: number;
    /** Short one-line summary for the collapsed row. */
    summary?: string;
    /** Fuller output preview, shown when the step is expanded in the UI. */
    detail?: string;
}

/** Run-global, mutable across the whole execution (incl. sub-workflows). */
interface RunState {
    modelCalls: number;
    trace: WorkflowTraceEntry[];
    /** Ordered live log of every executed step, re-emitted as a snapshot. */
    stepLog: StepProgress[];
    handles: WorkflowRunHandles;
    workflowId: string;
    workflowName: string;
    /** Artifacts created this run, by id — so a later update_artifact resolves them. */
    artifacts: Map<string, ArtifactRef>;
}

/** Per-scope, threaded explicitly so sub-workflows get a fresh variable scope. */
interface RunContext {
    input: Record<string, unknown>;
    steps: Record<string, unknown>;
    /** Sub-workflow recursion depth (root = 0). */
    depth: number;
    /** Latest evaluator critique, exposed to a generate sub-step as `{{feedback}}`. */
    feedback?: string;
}

/** Errors that should abort the whole run rather than be retried. */
class WorkflowError extends Error {}

// ── Templating ───────────────────────────────────────────────────────────────

function resolvePath(path: string, context: RunContext): unknown {
    const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
    let cur: any = { input: context.input, steps: context.steps, feedback: context.feedback ?? '' };
    for (const part of parts) {
        if (cur == null) return undefined;
        cur = cur[part];
    }
    return cur;
}

/** Replace `{{ input.x }}` / `{{ steps.id }}` tokens; objects are JSON-stringified. */
export function interpolate(template: string, context: RunContext): string {
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr: string) => {
        const value = resolvePath(expr, context);
        if (value === undefined || value === null) return '';
        if (typeof value === 'string') return value;
        // Arrays render as a readable list ("a, b, c") rather than JSON.
        if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
        return JSON.stringify(value, null, 2);
    });
}

// ── Engine ───────────────────────────────────────────────────────────────────

export class WorkflowEngine {
    private readonly model: LanguageModel;
    private readonly maxModelCalls: number;
    private readonly maxDepth: number;
    private readonly maxOutputTokens: number;
    private readonly reasoningEffort: ReasoningTier;
    /** Lazily-created fallback when no sandbox is supplied (e.g. direct test usage). */
    private fallbackSandbox?: Sandbox;

    constructor(model: LanguageModel, options: WorkflowEngineOptions = {}) {
        this.model = model;
        this.maxModelCalls = options.maxModelCalls ?? 25;
        this.maxDepth = options.maxDepth ?? 3;
        this.maxOutputTokens = options.maxOutputTokens ?? 4096;
        this.reasoningEffort = options.reasoningEffort ?? 'low';
    }

    /** Execute a workflow to completion, returning the final output + trace. */
    async run(
        workflow: Workflow,
        inputs: Record<string, unknown>,
        handles: WorkflowRunHandles = {},
    ): Promise<WorkflowRunResult> {
        const state: RunState = {
            modelCalls: 0,
            trace: [],
            stepLog: [],
            handles,
            workflowId: workflow.id,
            workflowName: workflow.name,
            artifacts: new Map(),
        };
        const context: RunContext = {
            input: this.bindInputs(workflow, inputs),
            steps: {},
            depth: 0,
        };

        // Initial snapshot (empty step list) so the UI shows the run starting.
        this.emitRun(state, 'running', workflow.description);

        try {
            if (!workflow.steps.length) throw new WorkflowError('workflow has no steps');
            let last: unknown;
            for (const step of workflow.steps) {
                last = await this.executeStep(step, state, context, 0);
            }
            this.emitRun(state, 'complete', workflow.description);
            return { success: true, finalOutput: last, trace: state.trace, modelCalls: state.modelCalls };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            this.emitRun(state, 'failed', workflow.description, error);
            return {
                success: false,
                finalOutput: context.steps,
                trace: state.trace,
                modelCalls: state.modelCalls,
                error,
            };
        }
    }

    // ── step dispatch (emit → run → store → trace) ──────────────────────────

    private async executeStep(
        step: WorkflowStep,
        state: RunState,
        context: RunContext,
        depth: number,
    ): Promise<unknown> {
        const progress: StepProgress = { id: step.id, kind: step.kind, title: step.title, status: 'running', depth };
        state.stepLog.push(progress);
        this.emitRun(state, 'running');
        try {
            const output = await this.runStep(step, state, context, depth, progress);
            context.steps[step.id] = output;
            const summary = summarize(output);
            progress.status = 'complete';
            progress.summary = summary;
            progress.detail = detailFor(output);
            state.trace.push({ stepId: step.id, kind: step.kind, status: 'complete', summary });
            this.emitRun(state, 'running');
            return output;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            progress.status = 'failed';
            progress.summary = message;
            progress.detail = message;
            state.trace.push({ stepId: step.id, kind: step.kind, status: 'failed', summary: message });
            this.emitRun(state, 'running');
            throw err;
        }
    }

    private runStep(
        step: WorkflowStep,
        state: RunState,
        context: RunContext,
        depth: number,
        progress: StepProgress,
    ): Promise<unknown> {
        switch (step.kind) {
            case 'prompt': return this.runPrompt(step, state, context, progress);
            case 'route': return this.runRoute(step, state, context, depth);
            case 'parallel': return this.runParallel(step, state, context, depth);
            case 'orchestrator': return this.runOrchestrator(step, state, context, depth, progress);
            case 'evaluator': return this.runEvaluator(step, state, context, depth, progress);
            case 'pipeline': return this.runPipeline(step, state, context, depth);
            case 'workflow': return this.runSubWorkflow(step, state, context, depth);
            case 'action': return this.runAction(step, state, context, progress);
            default: throw new WorkflowError(`unknown step kind: ${(step as WorkflowStep).kind}`);
        }
    }

    /** Update the current step's live summary and re-emit the run snapshot. */
    private report(state: RunState, progress: StepProgress, summary: string): void {
        progress.summary = summary;
        this.emitRun(state, 'running');
    }

    // ── pattern: sequential / prompt ─────────────────────────────────────────

    private async runPrompt(step: PromptStep, state: RunState, context: RunContext, progress: StepProgress): Promise<unknown> {
        const system = step.system ? interpolate(step.system, context) : undefined;
        const prompt = interpolate(step.prompt, context);
        const onText = this.streamInto(state, progress);
        if (step.schema) {
            const text = await this.callModel(state, {
                system: jsonInstruction(system, `a JSON value matching this JSON Schema:\n${JSON.stringify(step.schema)}`),
                prompt,
                temperature: step.temperature,
                onText,
            });
            return parseJsonValue(text) ?? text;
        }
        return this.callModel(state, { system, prompt, temperature: step.temperature, onText });
    }

    // ── pattern: routing ─────────────────────────────────────────────────────

    private async runRoute(step: RouteStep, state: RunState, context: RunContext, depth: number): Promise<unknown> {
        if (!step.routes?.length) throw new WorkflowError(`route step "${step.id}" has no routes`);
        const whens = step.routes.map((r) => r.when);
        const promptText = interpolate(step.prompt, context);

        // ponytail: cheap path — if the input plainly names exactly one category
        // (word-boundary, case-insensitive), route without a classifier model
        // call. 0 or >1 matches is ambiguous → fall back to the model. Upgrade to
        // a smarter matcher only if this misroutes.
        const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const keywordHits = whens.filter((w) => new RegExp(`\\b${escapeRe(w)}\\b`, 'i').test(promptText));

        let choice: string;
        if (keywordHits.length === 1) {
            choice = keywordHits[0];
        } else {
            const system = jsonInstruction(
                step.classifySystem ??
                    `You are a classifier. Choose exactly one category that best fits the input from: ${whens.join(', ')}.`,
                `a JSON object {"choice": one of [${whens.map((w) => `"${w}"`).join(', ')}], "reason": "<short>"}`,
            );
            const text = await this.callModel(state, { system, prompt: promptText });
            const parsed = parseJsonValue(text) as { choice?: string } | undefined;
            choice = parsed?.choice && whens.includes(parsed.choice) ? parsed.choice : whens[0];
        }
        const matched = step.routes.find((r) => r.when === choice) ?? step.routes[0];
        // Run the chosen branch as a nested step (its output is stored under its own id too).
        return this.executeStep(matched.step, state, context, depth + 1);
    }

    // ── pattern: parallel ────────────────────────────────────────────────────

    private async runParallel(step: ParallelStep, state: RunState, context: RunContext, depth: number): Promise<unknown> {
        if (!step.branches?.length) throw new WorkflowError(`parallel step "${step.id}" has no branches`);
        await Promise.all(step.branches.map((b) => this.executeStep(b, state, context, depth + 1)));
        // Branch outputs are stored in context.steps[branchId], so an aggregate
        // prompt can reference them via {{steps.<branchId>}}.
        if (step.aggregate) return this.executeStep(step.aggregate, state, context, depth + 1);
        // No aggregate → expose branch outputs keyed by id, so they're also
        // addressable as {{steps.<parallelId>.<branchId>}} (each branch remains
        // top-level too).
        const byId: Record<string, unknown> = {};
        for (const b of step.branches) byId[b.id] = context.steps[b.id];
        return byId;
    }

    // ── pattern: orchestrator-worker ─────────────────────────────────────────

    private async runOrchestrator(step: OrchestratorStep, state: RunState, context: RunContext, depth: number, progress: StepProgress): Promise<unknown> {
        this.report(state, progress, 'planning subtasks…');
        const plan = await this.callModel(state, {
            system: jsonInstruction(
                'You are an orchestrator. Break the objective into a focused list of INDEPENDENT subtasks. ' +
                    'Each subtask has a short title and a precise, self-contained prompt a worker can execute alone.',
                'a JSON object {"subtasks": [{"title": "<short>", "prompt": "<self-contained task>"}, ...]}',
            ),
            prompt: interpolate(step.objective, context),
        });
        const subtasks =
            (parseJsonValue(plan) as { subtasks?: Array<{ title: string; prompt: string }> } | undefined)?.subtasks ?? [];
        const workerSystem = step.workerSystem
            ? interpolate(step.workerSystem, context)
            : 'You are a focused worker. Complete the assigned subtask precisely and return only the result.';

        this.report(state, progress, `running ${subtasks.length} worker${subtasks.length === 1 ? '' : 's'}…`);
        const workers = await Promise.all(
            subtasks.map(async (st) => ({
                title: st.title,
                output: await this.callModel(state, { system: workerSystem, prompt: st.prompt }),
            })),
        );

        if (step.synthesize) {
            // Make the plan + worker outputs addressable to the synthesis prompt.
            context.steps[step.id] = { plan: subtasks, workers };
            return this.executeStep(step.synthesize, state, context, depth + 1);
        }
        return { plan: subtasks, workers };
    }

    // ── pattern: evaluator-optimizer ─────────────────────────────────────────

    private async runEvaluator(step: EvaluatorStep, state: RunState, context: RunContext, depth: number, progress: StepProgress): Promise<unknown> {
        const threshold = step.threshold ?? 8;
        const maxIterations = Math.max(1, step.maxIterations ?? 3);
        const gen = step.generate;
        // A plain prompt that doesn't already read {{feedback}} gets the critique
        // auto-appended; any other (composite) generate reads it via {{feedback}}.
        const autoAppend = gen.kind === 'prompt' && !/\{\{\s*feedback\s*\}\}/.test(gen.prompt);

        let best: { output: unknown; score: number } | undefined;
        let feedback = '';

        for (let i = 0; i < maxIterations; i++) {
            context.feedback = feedback;
            this.report(state, progress, `iteration ${i + 1}/${maxIterations}…`);

            let produced: unknown;
            if (autoAppend && gen.kind === 'prompt') {
                const base = interpolate(gen.prompt, context);
                const text = await this.callModel(state, {
                    system: gen.schema
                        ? jsonInstruction(
                            gen.system ? interpolate(gen.system, context) : undefined,
                            `a JSON value matching this JSON Schema:\n${JSON.stringify(gen.schema)}`,
                        )
                        : gen.system ? interpolate(gen.system, context) : undefined,
                    prompt: feedback ? `${base}\n\n## Reviewer feedback to address:\n${feedback}` : base,
                    temperature: gen.temperature,
                    onText: this.streamInto(state, progress),
                });
                produced = gen.schema ? (parseJsonValue(text) ?? text) : text;
                context.steps[gen.id] = produced;
            } else {
                // Composite generate (pipeline / orchestrator / …) — execute it as
                // a step; it reads the critique via {{feedback}} in its prompts.
                produced = await this.executeStep(gen, state, context, depth + 1);
            }
            const producedText = typeof produced === 'string' ? produced : JSON.stringify(produced, null, 2);

            const reviewText = await this.callModel(state, {
                system: jsonInstruction(
                    'You are a strict evaluator. Score the work from 1 (poor) to 10 (excellent) against the ' +
                        `criteria and give specific, actionable feedback.\nCriteria: ${interpolate(step.criteria, context)}`,
                    'a JSON object {"score": <integer 1-10>, "feedback": "<actionable feedback>"}',
                ),
                prompt: producedText,
            });
            const review = parseJsonValue(reviewText) as { score?: number; feedback?: string } | undefined;
            const score = Number(review?.score) || 0;
            feedback = review?.feedback ?? '';
            this.report(state, progress, `iteration ${i + 1}/${maxIterations} · score ${score}/10`);

            if (!best || score > best.score) best = { output: produced, score };
            if (score >= threshold) break;
        }
        return best?.output;
    }

    // ── composition: pipeline (run mixed-pattern steps in sequence) ──────────

    private async runPipeline(step: PipelineStep, state: RunState, context: RunContext, depth: number): Promise<unknown> {
        if (!step.steps?.length) throw new WorkflowError(`pipeline step "${step.id}" has no steps`);
        let last: unknown;
        for (const child of step.steps) {
            last = await this.executeStep(child, state, context, depth + 1);
        }
        return last;
    }

    // ── composition: sub-workflow ────────────────────────────────────────────

    private async runSubWorkflow(step: SubWorkflowStep, state: RunState, context: RunContext, depth: number): Promise<unknown> {
        if (context.depth >= this.maxDepth) {
            throw new WorkflowError(`sub-workflow depth limit (${this.maxDepth}) reached at "${step.id}"`);
        }
        const target = state.handles.resolveWorkflow?.(step.workflowName);
        if (!target) throw new WorkflowError(`sub-workflow "${step.workflowName}" not found (step "${step.id}")`);

        const mapped: Record<string, string> = {};
        for (const [key, value] of Object.entries(step.inputs ?? {})) {
            mapped[key] = interpolate(value, context);
        }
        const childContext: RunContext = {
            input: this.bindInputs(target, mapped),
            steps: {},
            depth: context.depth + 1,
        };

        let last: unknown;
        for (const childStep of target.steps) {
            last = await this.executeStep(childStep, state, childContext, depth + 1);
        }
        return last;
    }

    // ── actions: side-effects (canvas artifacts / file writes), no model call ─

    private sandboxFor(state: RunState): Sandbox {
        return state.handles.sandbox ?? (this.fallbackSandbox ??= new LocalSandbox('workspace'));
    }

    /** Resolve `params` templates, then dispatch the named side-effect. */
    private async runAction(step: ActionStep, state: RunState, context: RunContext, progress: StepProgress): Promise<unknown> {
        if (state.handles.abortSignal?.aborted) throw new WorkflowError('run aborted');
        const params: Record<string, string> = {};
        for (const [key, value] of Object.entries(step.params ?? {})) {
            params[key] = typeof value === 'string' ? interpolate(value, context) : value == null ? '' : String(value);
        }
        switch (step.action) {
            case 'create_artifact': return this.actionCreateArtifact(step, state, params, progress);
            case 'update_artifact': return this.actionUpdateArtifact(step, state, params, progress);
            case 'write_file': return this.actionWriteFile(step, state, params, progress);
            default: throw new WorkflowError(`unknown action "${(step as ActionStep).action}" in step "${step.id}"`);
        }
    }

    private async actionCreateArtifact(step: ActionStep, state: RunState, params: Record<string, string>, progress: StepProgress): Promise<unknown> {
        const title = (params.title || step.title || 'Artifact').trim();
        const kind = (params.kind || 'markdown').trim() as ArtifactKind;
        if (!ARTIFACT_EXT_BY_KIND[kind]) {
            throw new WorkflowError(`create_artifact (step "${step.id}"): unknown kind "${kind}" — use html, markdown, mermaid, or chart`);
        }
        const content = params.content ?? '';
        if (!content.trim()) throw new WorkflowError(`create_artifact (step "${step.id}"): "content" is empty (did the referenced step produce output?)`);
        if (kind === 'chart') validateChartSpec(content);

        const dir = state.handles.artifactsDir ?? 'artifacts';
        const id = `${slugifyArtifact(title)}-${Math.random().toString(36).slice(2, 6)}`;
        const filePath = path.posix.join(dir, `${id}.${ARTIFACT_EXT_BY_KIND[kind]}`);
        this.report(state, progress, `creating artifact “${title}” (${kind})`);
        await this.sandboxFor(state).writeFile(filePath, content);

        const ref: ArtifactRef = { id, title, kind, path: filePath, version: 1, summary: params.summary || undefined };
        state.artifacts.set(id, ref);
        state.handles.writer?.writeArtifact({ id, title, kind, content, version: 1, status: 'complete', path: filePath, summary: ref.summary });

        return { action: 'create_artifact', id, title, kind, version: 1, path: filePath };
    }

    private async actionUpdateArtifact(step: ActionStep, state: RunState, params: Record<string, string>, progress: StepProgress): Promise<unknown> {
        const id = (params.id ?? '').trim();
        if (!id) throw new WorkflowError(`update_artifact (step "${step.id}"): "id" param is required (e.g. {{steps.<createStepId>.id}})`);
        const content = params.content ?? '';
        if (!content.trim()) throw new WorkflowError(`update_artifact (step "${step.id}"): "content" is empty`);

        const dir = state.handles.artifactsDir ?? 'artifacts';
        const existing = state.artifacts.get(id) ?? (await this.recoverArtifact(state, dir, id));
        if (!existing) throw new WorkflowError(`update_artifact (step "${step.id}"): no artifact "${id}" — create it first, or check the id`);
        if (existing.kind === 'chart') validateChartSpec(content);

        const title = (params.title || existing.title).trim();
        const summary = params.summary || existing.summary;
        const version = existing.version + 1;
        this.report(state, progress, `updating artifact “${title}” (v${version})`);
        await this.sandboxFor(state).writeFile(existing.path, content);

        const ref: ArtifactRef = { ...existing, title, version, summary };
        state.artifacts.set(id, ref);
        state.handles.writer?.writeArtifact({ id, title, kind: existing.kind, content, version, status: 'complete', path: existing.path, summary });

        return { action: 'update_artifact', id, title, version, path: existing.path };
    }

    /** Find an artifact file on disk (after a reload / cross-run id reference). */
    private async recoverArtifact(state: RunState, dir: string, id: string): Promise<ArtifactRef | undefined> {
        const sandbox = this.sandboxFor(state);
        for (const [ext, kind] of Object.entries(ARTIFACT_KIND_BY_EXT)) {
            const candidate = path.posix.join(dir, `${id}.${ext}`);
            if (await sandbox.exists(candidate)) return { id, title: id, kind, path: candidate, version: 1 };
        }
        return undefined;
    }

    private async actionWriteFile(step: ActionStep, state: RunState, params: Record<string, string>, progress: StepProgress): Promise<unknown> {
        const filePath = (params.path ?? '').trim().replace(/^\/+/, '');
        if (!filePath) throw new WorkflowError(`write_file (step "${step.id}"): "path" param is required`);
        const content = params.content ?? '';
        this.report(state, progress, `writing ${filePath}`);
        await this.sandboxFor(state).writeFile(filePath, content);
        return { action: 'write_file', path: filePath, bytes: content.length };
    }

    // ── shared model call (budget + abort enforced here) ─────────────────────

    /**
     * Single model call — STREAMED (budget + abort enforced here). Always
     * plain-text generation — structured steps instruct the model to emit JSON
     * in the system prompt (see {@link jsonInstruction}) and parse the text with
     * {@link parseJsonValue}. We deliberately avoid the SDK's
     * `experimental_output`/`Output.object` here: it THROWS on models/providers
     * without native structured-output support (many free OpenRouter models),
     * which would hard-fail an otherwise-fine run. Manual JSON degrades
     * gracefully — an unparseable response just yields a low/empty result and
     * the run continues.
     *
     * `streamText` (not `generateText`) so `onText` can surface tokens live as
     * the step produces them; the system prompt is sent as a cache-marked
     * message so repeated calls that share it (evaluator iterations, the N
     * workers of an orchestrator) reuse the provider's prompt cache.
     */
    private async callModel(
        state: RunState,
        args: { system?: string; prompt: string; temperature?: number; onText?: (full: string) => void },
    ): Promise<string> {
        if (state.handles.abortSignal?.aborted) throw new WorkflowError('run aborted');
        if (state.modelCalls >= this.maxModelCalls) {
            throw new WorkflowError(`model-call budget (${this.maxModelCalls}) exceeded`);
        }
        state.modelCalls++;

        // v7: a provider/stream error is delivered to `onError` and the
        // textStream then completes WITHOUT throwing (unlike v6). Capture it
        // here and rethrow after draining so a failed call still rejects and is
        // traced as failed, rather than silently returning an empty result.
        let streamError: unknown;
        const result = streamText({
            model: this.model,
            // We pass the system prompt as a cache-marked system MESSAGE (see
            // cacheableMessages) rather than the `instructions` option, so the
            // provider prompt-cache breakpoint lands on it. v7 rejects system
            // messages in `messages` unless this is set.
            allowSystemInMessages: true,
            messages: cacheableMessages(args.system, args.prompt),
            onError: ({ error }) => { streamError = error; },
            // Bound per-step output so a rambling step can't dominate run latency.
            maxOutputTokens: this.maxOutputTokens,
            // Minimize reasoning: workflow steps are mechanical, so hidden
            // chain-of-thought is wasted latency. Foreign provider keys are ignored.
            // Cast: the helper returns loose `Record<string, unknown>`; values are
            // provider-namespaced JSON objects (matches the harness's own usage).
            providerOptions: reasoningProviderOptions(this.reasoningEffort) as Record<string, Record<string, any>>,
            ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
            ...(state.handles.abortSignal ? { abortSignal: state.handles.abortSignal } : {}),
        });

        let text = '';
        for await (const delta of result.textStream) {
            text += delta;
            args.onText?.(text);
        }
        if (streamError) {
            throw streamError instanceof Error ? streamError : new Error(String(streamError));
        }
        return text;
    }

    /**
     * A throttled per-step token sink: feeds the model's growing output into the
     * step's live `detail` and re-emits the run snapshot at most ~every 80ms, so
     * the UI shows text appearing instead of a frozen "running" row. Mirrors the
     * delta-throttle used when forwarding sub-agent streams.
     */
    private streamInto(state: RunState, progress: StepProgress): (full: string) => void {
        let lastEmit = 0;
        return (full: string) => {
            progress.detail = full.length > STREAM_DETAIL_CAP ? `${full.slice(0, STREAM_DETAIL_CAP)}…` : full;
            const now = Date.now();
            if (now - lastEmit >= 80) {
                lastEmit = now;
                this.emitRun(state, 'running');
            }
        };
    }

    private bindInputs(workflow: Workflow, provided: Record<string, unknown>): Record<string, unknown> {
        const bound: Record<string, unknown> = {};
        for (const input of workflow.inputs ?? []) {
            let raw: unknown;
            if (provided[input.name] !== undefined) raw = provided[input.name];
            else if (input.default !== undefined) raw = input.default;
            else continue;
            bound[input.name] = coerceInput(raw, input.type);
        }
        // Carry through any extra provided keys (e.g. sub-workflow mappings).
        for (const [key, value] of Object.entries(provided)) {
            if (!(key in bound)) bound[key] = value;
        }
        return bound;
    }

    /**
     * Emit the current run snapshot. Stable part id (`workflow-<id>`) means each
     * call REPLACES the previous in the UI, so the accumulating `stepLog` renders
     * as a live, in-place-updating checklist rather than a stack of events.
     */
    private emitRun(
        state: RunState,
        status: 'running' | 'complete' | 'failed',
        description?: string,
        error?: string,
    ): void {
        state.handles.writer?.writeWorkflow({
            id: state.workflowId,
            name: state.workflowName,
            action: 'run',
            status,
            ...(description ? { description } : {}),
            steps: state.stepLog.map((s) => ({
                id: s.id,
                kind: s.kind,
                ...(s.title ? { title: s.title } : {}),
                status: s.status,
                depth: s.depth,
                ...(s.summary ? { summary: s.summary } : {}),
                ...(s.detail ? { detail: s.detail } : {}),
            })),
            modelCalls: state.modelCalls,
            ...(error ? { error } : {}),
        });
    }
}

function summarize(output: unknown): string {
    if (output === undefined || output === null) return '';
    const text = typeof output === 'string' ? output : JSON.stringify(output);
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/** A fuller per-step output preview for the expandable UI (the full output lives
 *  in the run-output file; this is just enough to "see what's going on"). */
function detailFor(output: unknown): string {
    if (output === undefined || output === null) return '';
    const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    const CAP = 2500;
    return text.length > CAP ? `${text.slice(0, CAP)}\n…[+${text.length - CAP} more chars]` : text;
}

/** Coerce a provided input value (or its declared default) to the input's type. */
function coerceInput(value: unknown, type: WorkflowInputType | undefined): unknown {
    switch (type) {
        case 'number': {
            const n = typeof value === 'number' ? value : Number(value);
            return Number.isFinite(n) ? n : undefined;
        }
        case 'boolean':
            return typeof value === 'boolean' ? value : /^(true|1|yes|on)$/i.test(String(value).trim());
        case 'array': {
            if (Array.isArray(value)) return value;
            if (typeof value === 'string') {
                const s = value.trim();
                if (s.startsWith('[')) {
                    try {
                        const parsed = JSON.parse(s);
                        if (Array.isArray(parsed)) return parsed;
                    } catch {
                        /* not a JSON array → fall back to comma-split */
                    }
                }
                return s ? s.split(',').map((x) => x.trim()).filter(Boolean) : [];
            }
            return value == null ? value : [value];
        }
        case 'json': {
            if (typeof value !== 'string') return value; // already an object/array/number/…
            try {
                return JSON.parse(value);
            } catch {
                return value;
            }
        }
        default:
            return typeof value === 'string' ? value : value == null ? value : String(value);
    }
}

/** Cap for live-streamed step text in the UI snapshot (full output is the step result). */
const STREAM_DETAIL_CAP = 2500;

/**
 * Build the message list for a step call with an ephemeral cache breakpoint on
 * the (stable) system prompt. Repeated calls that share a system — an
 * evaluator's iterations, the workers of an orchestrator — then hit the
 * provider's prompt cache. Providers that auto-cache prefixes (OpenAI) or don't
 * cache at all simply ignore the unknown `providerOptions` keys, so it's safe
 * across the OpenAI/OpenRouter/Anthropic models this engine runs on.
 */
function cacheableMessages(system: string | undefined, prompt: string): ModelMessage[] {
    const messages: ModelMessage[] = [];
    if (system) {
        const cacheControl = { cacheControl: { type: 'ephemeral' } } as const;
        messages.push({
            role: 'system',
            content: system,
            providerOptions: { anthropic: cacheControl, bedrock: cacheControl, openrouter: cacheControl },
        });
    }
    messages.push({ role: 'user', content: prompt });
    return messages;
}

/** Append a strict "respond with only JSON" directive to a system prompt. */
function jsonInstruction(system: string | undefined, shape: string): string {
    const directive = `Respond with ONLY ${shape}. Output strictly valid JSON and nothing else — no explanation, no markdown code fences.`;
    return system ? `${system}\n\n${directive}` : directive;
}

/** Best-effort JSON extraction from model text (direct parse, then fenced/braced). */
function parseJsonValue(text: string): unknown {
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        // fall through to extraction
    }
    const match =
        text.match(/```json\s*([\s\S]*?)\s*```/) ||
        text.match(/```\s*([\s\S]*?)\s*```/) ||
        text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) {
        try {
            return JSON.parse(match[1]);
        } catch {
            return undefined;
        }
    }
    return undefined;
}

// ── static validation (no model calls) ───────────────────────────────────────

export interface WorkflowValidation {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/** Recursively collect every step (including nested branches/aggregates). */
export function collectSteps(steps: WorkflowStep[]): WorkflowStep[] {
    const out: WorkflowStep[] = [];
    const visit = (step: WorkflowStep): void => {
        out.push(step);
        switch (step.kind) {
            case 'route': step.routes?.forEach((r) => visit(r.step)); break;
            case 'parallel':
                step.branches?.forEach(visit);
                if (step.aggregate) visit(step.aggregate);
                break;
            case 'orchestrator': if (step.synthesize) visit(step.synthesize); break;
            case 'evaluator': visit(step.generate); break;
            case 'pipeline': step.steps?.forEach(visit); break;
        }
    };
    steps.forEach(visit);
    return out;
}

function templatesOf(step: WorkflowStep): string[] {
    switch (step.kind) {
        case 'prompt': return [step.system, step.prompt].filter(Boolean) as string[];
        case 'route': return [step.prompt, step.classifySystem].filter(Boolean) as string[];
        case 'orchestrator': return [step.objective, step.workerSystem].filter(Boolean) as string[];
        case 'evaluator': return [step.criteria].filter(Boolean) as string[];
        case 'workflow': return Object.values(step.inputs ?? {});
        case 'action': return Object.values(step.params ?? {});
        default: return [];
    }
}

/**
 * Statically validate a workflow without running it: unique ids, resolvable
 * `{{...}}` references, non-empty routes/branches, and (when a resolver is
 * given) existing sub-workflow targets. Cheap — no model calls.
 */
export function validateWorkflow(
    workflow: Pick<Workflow, 'name' | 'inputs' | 'steps'>,
    resolveWorkflow?: (name: string) => Workflow | undefined,
): WorkflowValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!workflow.name?.trim()) errors.push('workflow name is required');
    if (!workflow.steps?.length) errors.push('workflow has no steps');

    const all = collectSteps(workflow.steps ?? []);
    const ids = new Set<string>();
    for (const step of all) {
        if (!step.id?.trim()) { errors.push(`a ${step.kind} step is missing an id`); continue; }
        if (ids.has(step.id)) errors.push(`duplicate step id: "${step.id}"`);
        ids.add(step.id);
        if (step.kind === 'route' && !step.routes?.length) errors.push(`route step "${step.id}" has no routes`);
        if (step.kind === 'parallel' && !step.branches?.length) errors.push(`parallel step "${step.id}" has no branches`);
        if (step.kind === 'workflow' && resolveWorkflow && !resolveWorkflow(step.workflowName)) {
            errors.push(`sub-workflow "${step.workflowName}" (step "${step.id}") does not exist`);
        }
        if (step.kind === 'action') {
            const action = (step as ActionStep).action;
            const known: ActionKind[] = ['create_artifact', 'update_artifact', 'write_file'];
            if (!action) errors.push(`action step "${step.id}" is missing an "action"`);
            else if (!known.includes(action)) errors.push(`action step "${step.id}" has unknown action "${action}" (use ${known.join(', ')})`);
        }
    }

    const inputNames = new Set((workflow.inputs ?? []).map((i) => i.name));
    for (const step of all) {
        for (const template of templatesOf(step)) {
            const tokens = [...template.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1].trim());
            for (const token of tokens) {
                const [root, name] = token.split('.').map((p) => p.trim());
                if (root === 'input') {
                    if (name && !inputNames.has(name)) warnings.push(`step "${step.id}" references undeclared input "{{${token}}}"`);
                } else if (root === 'steps') {
                    if (name && !ids.has(name)) warnings.push(`step "${step.id}" references unknown step "{{${token}}}"`);
                } else if (root === 'feedback') {
                    // Valid inside an evaluator's `generate` (the latest critique); resolves to '' elsewhere.
                } else {
                    warnings.push(`step "${step.id}" has unrecognized reference "{{${token}}}" (use input.*, steps.*, or feedback)`);
                }
            }
        }
    }

    return { valid: errors.length === 0, errors, warnings };
}
