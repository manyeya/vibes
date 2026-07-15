import { tool, type LanguageModel, type UIMessageStreamWriter } from 'ai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import {
    Plugin,
    PluginStreamContext,
    VibesUIMessage,
    createDataStreamWriter,
    type DataStreamWriter,
} from '../core/types';
import {
    WorkflowEngine,
    validateWorkflow,
    type Workflow,
    type WorkflowStep,
    type WorkflowRunResult,
} from './workflow-engine';
import { type Sandbox } from '../core/sandbox';
import { LocalSandbox } from '../sandbox/local-sandbox';

export type { Workflow, WorkflowStep, StepKind } from './workflow-engine';
export { validateWorkflow, type WorkflowValidation } from './workflow-engine';

/** How many workflow headers to surface in the system-prompt index. */
const MAX_INDEX_WORKFLOWS = 40;

/** A bounded, structural outline of a step (kinds/titles + short previews, no full bodies).
 *  Loosely typed on purpose — it just reads whichever optional fields a step carries. */
function outlineStep(s: any): Record<string, unknown> {
    const preview = (t?: string) => (t && t.length > 140 ? `${t.slice(0, 140)}…` : t);
    const o: Record<string, unknown> = { id: s.id, kind: s.kind };
    if (s.title) o.title = s.title;
    if (s.prompt) o.prompt = preview(s.prompt);
    if (s.objective) o.objective = preview(s.objective);
    if (s.criteria) o.criteria = preview(s.criteria);
    if (s.workflowName) o.workflowName = s.workflowName;
    if (s.action) o.action = s.action;
    if (s.params) o.params = Object.keys(s.params);
    if (typeof s.threshold === 'number') o.threshold = s.threshold;
    if (typeof s.maxIterations === 'number') o.maxIterations = s.maxIterations;
    if (s.routes) o.routes = s.routes.map((r: any) => ({ when: r.when, step: outlineStep(r.step) }));
    if (s.branches) o.branches = s.branches.map(outlineStep);
    if (s.aggregate) o.aggregate = outlineStep(s.aggregate);
    if (s.synthesize) o.synthesize = outlineStep(s.synthesize);
    if (s.generate) o.generate = outlineStep(s.generate);
    if (s.steps) o.steps = s.steps.map(outlineStep);
    return o;
}

/** Guess a file extension for a saved run output, so an HTML/JSON deliverable is usable as-is. */
function outputExt(content: string): string {
    const head = content.slice(0, 400).toLowerCase();
    if (head.includes('<!doctype html') || head.includes('<html')) return 'html';
    const trimmed = content.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
    if (trimmed.startsWith('# ') || trimmed.startsWith('## ')) return 'md';
    return 'txt';
}

/** Persist a (large) run output to `<baseDir>/workflow_runs/…` — the workspace root bash reads from. */
async function writeRunOutputFile(name: string, content: string, baseDir?: string): Promise<{ path: string; ext: string }> {
    const base = baseDir ?? process.cwd();
    const dir = path.join(base, 'workflow_runs');
    await fs.mkdir(dir, { recursive: true }).catch(() => {});
    const ext = outputExt(content);
    const slug = name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'workflow';
    const fileName = `${slug}_${Date.now().toString(36)}.${ext}`;
    await fs.writeFile(path.join(dir, fileName), content, 'utf8');
    return { path: `workflow_runs/${fileName}`, ext };
}

export interface RunWorkflowOptions {
    model: LanguageModel;
    inputs: Record<string, unknown>;
    /** Scoped writer for live `data-workflow` step parts + the canvas artifact. */
    writer?: DataStreamWriter;
    abortSignal?: AbortSignal;
    maxModelCalls?: number;
    /** Workspace root for the run-output file (bash's root). */
    workspaceDir?: string;
    sandbox?: Sandbox;
    /** Resolve `workflow` (sub-workflow) steps by name — usually over the same library. */
    resolveWorkflow?: (name: string) => Workflow | undefined;
}

export interface RunWorkflowOutcome {
    success: boolean;
    error?: string;
    /** Workspace-relative path to the saved output (large results). */
    outputPath?: string;
    outputChars?: number;
    outputPreview?: string;
    /** Inline output (small results). */
    finalOutput?: unknown;
    /** True when an HTML/markdown artifact was streamed to the canvas. */
    rendered?: boolean;
    trace?: WorkflowRunResult['trace'];
    modelCalls?: number;
    message?: string;
}

/**
 * Run a workflow and handle its output uniformly — the single source of truth
 * shared by the `run_workflow` tool and the direct HTTP run endpoint. Streams
 * live `data-workflow` parts via the writer, persists a large final output to a
 * file (+ renders an HTML/markdown artifact in the canvas), and returns a
 * compact result.
 */
export async function runWorkflowToStream(workflow: Workflow, opts: RunWorkflowOptions): Promise<RunWorkflowOutcome> {
    // Actions (create_artifact / write_file) need a filesystem; default one
    // rooted at the workspace when the caller didn't pass a shared sandbox.
    const sandbox = opts.sandbox ?? new LocalSandbox(opts.workspaceDir ?? process.cwd());
    const engine = new WorkflowEngine(opts.model, { maxModelCalls: opts.maxModelCalls });
    const result = await engine.run(workflow, opts.inputs, {
        writer: opts.writer,
        abortSignal: opts.abortSignal,
        resolveWorkflow: opts.resolveWorkflow,
        sandbox,
    });

    if (!result.success) {
        return { success: false, error: result.error, trace: result.trace, modelCalls: result.modelCalls };
    }

    const outStr = typeof result.finalOutput === 'string'
        ? result.finalOutput
        : JSON.stringify(result.finalOutput, null, 2);

    const INLINE_LIMIT = 2000;
    if (outStr.length <= INLINE_LIMIT) {
        return { success: true, finalOutput: result.finalOutput, trace: result.trace, modelCalls: result.modelCalls };
    }

    const { path: rel, ext } = await writeRunOutputFile(workflow.name, outStr, opts.sandbox?.root ?? opts.workspaceDir);
    const rendered = ext === 'html' || ext === 'md';
    if (rendered) {
        opts.writer?.writeArtifact({
            id: `wf-${workflow.id}-${Date.now().toString(36)}`,
            title: workflow.name,
            kind: ext === 'html' ? 'html' : 'markdown',
            content: outStr,
            version: 1,
            status: 'complete',
            path: rel,
            summary: `Output of workflow "${workflow.name}"`,
        });
    }

    return {
        success: true,
        outputPath: rel,
        outputChars: outStr.length,
        outputPreview: `${outStr.slice(0, 1200)}\n…[preview truncated — read the file for the COMPLETE output]`,
        trace: result.trace,
        modelCalls: result.modelCalls,
        ...(rendered ? { rendered: true } : {}),
        message:
            `Workflow "${workflow.name}" finished. The full output (${outStr.length} chars) was saved to "${rel}"` +
            `${rendered ? ' and is now rendered in the canvas panel' : ''}. Read it with bash (e.g. \`cat ${rel}\`) ` +
            'or copy it where you need it — do NOT rely on the preview, and do NOT re-run the workflow just to get the output.',
    };
}

export interface WorkflowPluginConfig {
    /** Path to the JSON workflow library (default: workspace/workflows.json). */
    workflowsPath?: string;
    /** Cap on stored workflows (oldest-updated trimmed past this). */
    maxWorkflows?: number;
    /** Per-run model-call budget passed to the engine (default 25). */
    maxModelCalls?: number;
    /**
     * Optional dedicated model for RUNNING workflows, separate from the agent's
     * chat model. A workflow is many sequential calls of mechanical work, so a
     * fast (ideally non-reasoning) model here cuts run latency sharply. Falls
     * back to the agent model when unset.
     */
    workflowModel?: LanguageModel;
    /**
     * The bash/filesystem workspace dir (or pass {@link sandbox}). Lets
     * `import_workflow` read a definition file the agent wrote via bash — the
     * reliable path for large/deeply-nested workflows that don't survive being
     * passed as one giant `create_workflow` argument.
     */
    workspaceDir?: string;
    /** Sandbox shared with the bash plugin; its `root` locates import files. */
    sandbox?: Sandbox;
}

/**
 * A loose, recursive schema for a workflow step. Steps are heterogeneous and
 * nest arbitrarily (a route's branch is itself a step), so one permissive shape
 * with optional per-pattern fields is the robust way to accept them from a tool
 * call. Correctness is enforced afterward by {@link validateWorkflow} and the
 * engine — not by this schema.
 */
const stepSchema: z.ZodType<any> = z.lazy(() =>
    z.object({
        id: z.string().describe('Unique id within the workflow; addressable as {{steps.<id>}}.'),
        kind: z.enum(['prompt', 'route', 'parallel', 'orchestrator', 'evaluator', 'pipeline', 'workflow', 'action']),
        title: z.string().optional(),
        // prompt
        system: z.string().optional(),
        prompt: z.string().optional().describe('Prompt text; supports {{input.x}} and {{steps.id}} interpolation.'),
        schema: z.record(z.string(), z.any()).optional().describe('Optional JSON schema for structured output.'),
        temperature: z.number().optional(),
        // route
        classifySystem: z.string().optional(),
        routes: z.array(z.object({ when: z.string(), step: stepSchema })).optional(),
        // parallel
        branches: z.array(stepSchema).optional(),
        aggregate: stepSchema.optional(),
        // orchestrator
        objective: z.string().optional(),
        workerSystem: z.string().optional(),
        synthesize: stepSchema.optional(),
        // evaluator (generate / aggregate / synthesize accept ANY step kind, so
        // patterns nest — e.g. evaluate a pipeline, aggregate via an orchestrator)
        generate: stepSchema.optional(),
        criteria: z.string().optional(),
        threshold: z.number().optional(),
        maxIterations: z.number().optional(),
        // pipeline (run mixed-pattern sub-steps in sequence)
        steps: z.array(stepSchema).optional(),
        // sub-workflow
        workflowName: z.string().optional(),
        inputs: z.record(z.string(), z.string()).optional(),
        // action (side-effect — no model call)
        action: z.enum(['create_artifact', 'update_artifact', 'write_file']).optional()
            .describe('For an action step: the side-effect to perform.'),
        params: z.record(z.string(), z.string()).optional()
            .describe('Action params (templated, support {{steps.*}}/{{input.*}}): create_artifact{title,kind:html|markdown|mermaid|chart,content,summary?}; update_artifact{id,content,title?,summary?}; write_file{path,content}.'),
    }),
);

const inputDefSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    type: z.enum(['string', 'number', 'boolean', 'array', 'json']).optional().describe('Value type (default string). Values are coerced to it; "array" accepts a list or a comma-separated string.'),
    enum: z.array(z.string()).optional().describe('For a string input, the allowed values.'),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

/**
 * WorkflowPlugin — lets the agent define, save, and run reusable **workflows**
 * built from the AI SDK's low-level agent patterns (sequential chains, routing,
 * parallelization, orchestrator-worker, evaluator-optimizer) plus sub-workflow
 * composition.
 *
 * Definitions are plain JSON persisted to `workflows.json` (shared across
 * sessions, like memories). Execution is delegated to {@link WorkflowEngine},
 * which makes the real model calls and flows data between steps. A compact
 * library index is injected into the system prompt so the agent re-runs a known
 * workflow instead of re-deriving it.
 */
export default class WorkflowPlugin implements Plugin {
    name = 'WorkflowPlugin';

    private writer?: DataStreamWriter;
    private streamContext?: PluginStreamContext;
    private readonly model?: LanguageModel;
    private readonly workflowModel?: LanguageModel;
    private readonly workflowsPath: string;
    private readonly maxWorkflows: number;
    private readonly maxModelCalls: number;
    private readonly workspaceDir?: string;
    private readonly sandbox?: Sandbox;

    constructor(model?: LanguageModel, config: WorkflowPluginConfig = {}) {
        this.model = model;
        this.workflowModel = config.workflowModel;
        this.workflowsPath = config.workflowsPath || 'workspace/workflows.json';
        this.maxWorkflows = config.maxWorkflows ?? 200;
        this.maxModelCalls = config.maxModelCalls ?? 25;
        this.workspaceDir = config.workspaceDir;
        this.sandbox = config.sandbox;
    }

    onStreamContextReady(context: PluginStreamContext) {
        this.streamContext = context;
        this.writer = context.writer.withDefaults({ plugin: this.name });
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.streamContext = undefined;
        this.writer = createDataStreamWriter(writer).withDefaults({ plugin: this.name });
    }

    async waitReady() {
        await fs.mkdir(path.dirname(this.resolve(this.workflowsPath)), { recursive: true }).catch(() => {});
    }

    private createOperation(name: string, toolName: string) {
        return this.streamContext?.createOperation({
            name,
            toolName,
            plugin: this.name,
        });
    }

    // ── storage (mirrors memory.ts) ──────────────────────────────────────────

    private resolve(p: string): string {
        return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    }

    private async readWorkflows(): Promise<Workflow[]> {
        try {
            const raw = await fs.readFile(this.resolve(this.workflowsPath), 'utf8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as Workflow[]) : [];
        } catch {
            return [];
        }
    }

    private async writeWorkflows(workflows: Workflow[]): Promise<void> {
        await fs.mkdir(path.dirname(this.resolve(this.workflowsPath)), { recursive: true }).catch(() => {});
        const capped = [...workflows]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, this.maxWorkflows);
        await fs.writeFile(this.resolve(this.workflowsPath), JSON.stringify(capped, null, 2), 'utf8');
    }

    private static find(workflows: Workflow[], nameOrId: string): Workflow | undefined {
        return workflows.find((w) => w.id === nameOrId || w.name === nameOrId);
    }

    /**
     * Validate + persist a workflow definition. Shared by create_workflow and
     * import_workflow so both go through the exact same checks. Tolerant of
     * loose/unknown shapes (import comes straight from a file).
     */
    private async saveDefinition(
        def: { name?: unknown; slug?: unknown; description?: unknown; inputs?: unknown; steps?: unknown; tags?: unknown },
        overwrite: boolean,
    ): Promise<Record<string, unknown>> {
        const name = typeof def.name === 'string' ? def.name.trim() : '';
        if (!name) return { success: false, error: 'Workflow "name" is required.' };
        if (!Array.isArray(def.steps) || def.steps.length === 0) {
            return { success: false, error: 'Workflow "steps" must be a non-empty array.' };
        }

        const workflows = await this.readWorkflows();
        const existing = WorkflowPlugin.find(workflows, name);
        if (existing && !overwrite) {
            return {
                success: false,
                error: `A workflow named "${name}" already exists (id ${existing.id}). Pass overwrite:true or use update_workflow.`,
            };
        }

        const inputs = (Array.isArray(def.inputs) ? def.inputs : []) as Workflow['inputs'];
        const steps = def.steps as WorkflowStep[];
        const validation = validateWorkflow({ name, inputs, steps }, (n) => WorkflowPlugin.find(workflows, n));
        if (!validation.valid) {
            return { success: false, errors: validation.errors, warnings: validation.warnings };
        }

        const now = new Date().toISOString();
        const workflow: Workflow = {
            id: existing?.id ?? `wf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            name,
            ...(typeof def.slug === 'string' && def.slug.trim() ? { slug: def.slug.trim() } : {}),
            description: typeof def.description === 'string' ? def.description : '',
            tags: (Array.isArray(def.tags) ? def.tags : []) as string[],
            inputs,
            steps,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            version: existing ? existing.version + 1 : 1,
        };

        await this.writeWorkflows(existing ? workflows.map((w) => (w.id === existing.id ? workflow : w)) : [...workflows, workflow]);
        this.writer?.writeWorkflow({ id: workflow.id, name: workflow.name, action: 'saved', description: workflow.description });

        return {
            success: true,
            id: workflow.id,
            name: workflow.name,
            version: workflow.version,
            stepCount: workflow.steps.length,
            warnings: validation.warnings,
            message: `Saved workflow "${name}". Run it with run_workflow.`,
        };
    }

    /**
     * Read a workflow file the agent wrote via bash. Bash runs against real disk
     * rooted at the workspace (sandbox root), so we resolve the given path there
     * (a leading "/" is workspace-root-relative, matching the shell's cwp of "/").
     */
    private async readImportFile(p: string): Promise<string> {
        const rel = p.replace(/^\/+/, '');
        const base = this.sandbox?.root ?? this.workspaceDir ?? process.cwd();
        const candidates = [
            path.join(base, rel),
            path.resolve(process.cwd(), p),
            ...(path.isAbsolute(p) ? [p] : []),
        ];
        for (const candidate of candidates) {
            try {
                return await fs.readFile(candidate, 'utf8');
            } catch {
                /* try next candidate */
            }
        }
        throw new Error(
            `Could not read workflow file "${p}". Write it in your workspace first ` +
            `(bash: cat > my-workflow.json <<'EOF' … EOF), then import_workflow({ path: "my-workflow.json" }).`,
        );
    }

    // ── tools ────────────────────────────────────────────────────────────────

    get tools(): Record<string, import("ai").Tool> {
        return {
            create_workflow: tool({
                description:
                    'Define and save a reusable, multi-step workflow built from low-level AI SDK patterns ' +
                    '(prompt chain, route, parallel, orchestrator, evaluator, sub-workflow). Saved to disk and ' +
                    'reusable across sessions; run later with run_workflow. Step prompts may interpolate ' +
                    '{{input.<name>}} and {{steps.<id>}}.',
                inputSchema: z.object({
                    name: z.string().describe('Unique handle, e.g. "draft-and-refine-copy".'),
                    slug: z.string().optional().describe('Optional short alias for /slug invocation, e.g. "draft".'),
                    description: z.string().describe('What it does / when to use it.'),
                    inputs: z.array(inputDefSchema).optional().describe('Declared inputs referenced as {{input.<name>}}.'),
                    steps: z.array(stepSchema).min(1).describe('Steps, executed in order.'),
                    tags: z.array(z.string()).optional(),
                    overwrite: z.boolean().optional().describe('Replace an existing workflow with the same name.'),
                }),
                execute: async ({ name, slug, description, inputs, steps, tags, overwrite }) => {
                    const op = this.createOperation('create-workflow', 'create_workflow');
                    const result = await this.saveDefinition({ name, slug, description, inputs, steps, tags }, !!overwrite);
                    if (result.success) op?.complete(`Saved workflow "${name}"`, { phase: 'complete' });
                    else op?.fail(String(result.error ?? (result.errors as string[] | undefined)?.[0] ?? 'Invalid workflow'));
                    return result;
                },
            }),

            import_workflow: tool({
                description:
                    'Save a workflow from a JSON file you wrote in the workspace (or a raw JSON string). ' +
                    'USE THIS FOR LARGE OR DEEPLY-NESTED WORKFLOWS instead of create_workflow — passing a big ' +
                    'nested definition as one tool argument is unreliable. Reliable path: write the full ' +
                    "definition to a file with bash (cat > my-workflow.json <<'EOF' { … } EOF), then call " +
                    'import_workflow({ path: "my-workflow.json" }). The JSON must be a full workflow object: ' +
                    '{ name, description, inputs?, steps, tags? }. Validated and saved exactly like create_workflow.',
                inputSchema: z.object({
                    path: z.string().optional().describe('Path to a workflow JSON file in your workspace, e.g. "my-workflow.json".'),
                    json: z.string().optional().describe('Alternatively, the raw workflow JSON as a string.'),
                    overwrite: z.boolean().optional().describe('Replace an existing workflow with the same name.'),
                }),
                execute: async ({ path: filePath, json, overwrite }) => {
                    const op = this.createOperation('import-workflow', 'import_workflow');
                    let raw: string;
                    try {
                        if (json && json.trim()) raw = json;
                        else if (filePath && filePath.trim()) raw = await this.readImportFile(filePath);
                        else {
                            op?.fail('No path or json provided');
                            return { success: false, error: 'Provide a file "path" or a "json" string.' };
                        }
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        op?.fail(msg);
                        return { success: false, error: msg };
                    }

                    let def: unknown;
                    try {
                        def = JSON.parse(raw);
                    } catch (e) {
                        const msg = `The workflow content is not valid JSON: ${(e as Error).message}`;
                        op?.fail(msg);
                        return { success: false, error: msg };
                    }
                    // Tolerate a one-element array wrapper.
                    if (Array.isArray(def)) def = def[0];

                    const result = await this.saveDefinition((def ?? {}) as Record<string, unknown>, !!overwrite);
                    if (result.success) op?.complete(`Imported workflow "${result.name}" (${result.stepCount} steps)`, { phase: 'complete' });
                    else op?.fail(String(result.error ?? (result.errors as string[] | undefined)?.[0] ?? 'Invalid workflow'));
                    return result;
                },
            }),

            list_workflows: tool({
                description:
                    'List saved workflows with everything needed to RUN them: id, name, description, tags, step ' +
                    'count, and the FULL declared inputs (name/description/required/default). No file lookup needed.',
                inputSchema: z.object({}),
                execute: async () => {
                    const workflows = await this.readWorkflows();
                    return {
                        count: workflows.length,
                        workflows: workflows
                            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                            .map((w) => ({
                                id: w.id,
                                name: w.name,
                                description: w.description,
                                tags: w.tags,
                                stepCount: w.steps.length,
                                inputs: w.inputs, // full specs: name, description, required, default
                            })),
                    };
                },
            }),

            get_workflow: tool({
                description:
                    "Get a saved workflow's interface — its inputs (what to pass to run_workflow), description, tags, " +
                    'and a compact step OUTLINE (kinds/titles + short prompt previews). This is what you need to run ' +
                    'it. Pass raw:true for the complete definition with full prompt bodies (large — may be truncated).',
                inputSchema: z.object({
                    nameOrId: z.string(),
                    raw: z.boolean().optional().describe('Return the full definition incl. every prompt body (large).'),
                }),
                execute: async ({ nameOrId, raw }) => {
                    const workflow = WorkflowPlugin.find(await this.readWorkflows(), nameOrId);
                    if (!workflow) return { success: false, error: `No workflow "${nameOrId}". Use list_workflows.` };
                    if (raw) return { success: true, workflow };
                    const ins = workflow.inputs ?? [];
                    return {
                        success: true,
                        id: workflow.id,
                        name: workflow.name,
                        description: workflow.description,
                        tags: workflow.tags,
                        inputs: ins, // full input specs — exactly what run_workflow needs
                        stepCount: workflow.steps.length,
                        outline: workflow.steps.map(outlineStep),
                        runWith: `run_workflow({ nameOrId: "${workflow.name}", inputs: { ${ins
                            .map((i) => {
                                const sample = i.type === 'number' ? '0' : i.type === 'boolean' ? 'false' : i.type === 'array' ? '["…"]' : i.type === 'json' ? '{}' : '"…"';
                                return `${i.name}: ${sample}`;
                            })
                            .join(', ')} } })`,
                    };
                },
            }),

            update_workflow: tool({
                description: 'Revise a saved workflow by id (replace any of name/description/inputs/steps/tags). Bumps version.',
                inputSchema: z.object({
                    id: z.string(),
                    name: z.string().optional(),
                    slug: z.string().optional(),
                    description: z.string().optional(),
                    inputs: z.array(inputDefSchema).optional(),
                    steps: z.array(stepSchema).optional(),
                    tags: z.array(z.string()).optional(),
                }),
                execute: async ({ id, name, slug, description, inputs, steps, tags }) => {
                    const op = this.createOperation('update-workflow', 'update_workflow');
                    const workflows = await this.readWorkflows();
                    const workflow = workflows.find((w) => w.id === id);
                    if (!workflow) {
                        op?.fail(`No workflow ${id}`);
                        return { success: false, error: `No workflow with id ${id}. Use list_workflows.` };
                    }

                    const updated: Workflow = {
                        ...workflow,
                        name: name ?? workflow.name,
                        slug: slug !== undefined ? (slug.trim() || undefined) : workflow.slug,
                        description: description ?? workflow.description,
                        inputs: (inputs ?? workflow.inputs) as Workflow['inputs'],
                        steps: (steps ?? workflow.steps) as WorkflowStep[],
                        tags: tags ?? workflow.tags,
                        updatedAt: new Date().toISOString(),
                        version: workflow.version + 1,
                    };

                    const validation = validateWorkflow(updated, (n) => WorkflowPlugin.find(workflows, n));
                    if (!validation.valid) {
                        op?.fail(`Invalid workflow: ${validation.errors[0]}`);
                        return { success: false, errors: validation.errors, warnings: validation.warnings };
                    }

                    await this.writeWorkflows(workflows.map((w) => (w.id === id ? updated : w)));
                    this.writer?.writeWorkflow({
                        id: updated.id,
                        name: updated.name,
                        action: 'saved',
                        description: updated.description,
                    });
                    op?.complete(`Updated workflow "${updated.name}" (v${updated.version})`, { phase: 'complete' });
                    return { success: true, id, version: updated.version, warnings: validation.warnings };
                },
            }),

            delete_workflow: tool({
                description: 'Delete a saved workflow by id.',
                inputSchema: z.object({ id: z.string() }),
                execute: async ({ id }) => {
                    const workflows = await this.readWorkflows();
                    const next = workflows.filter((w) => w.id !== id);
                    if (next.length === workflows.length) return { success: false, error: `No workflow with id ${id}.` };
                    await this.writeWorkflows(next);
                    return { success: true, message: `Deleted workflow ${id}.` };
                },
            }),

            validate_workflow: tool({
                description:
                    'Statically check a workflow (saved by nameOrId, or an inline definition) WITHOUT running it: ' +
                    'unique step ids, resolvable {{...}} references, non-empty routes/branches, existing sub-workflow targets. ' +
                    'Cheap — no model calls. Use before run_workflow to catch authoring mistakes.',
                inputSchema: z.object({
                    nameOrId: z.string().optional(),
                    definition: z
                        .object({
                            name: z.string(),
                            inputs: z.array(inputDefSchema).optional(),
                            steps: z.array(stepSchema).min(1),
                        })
                        .optional(),
                }),
                execute: async ({ nameOrId, definition }) => {
                    const workflows = await this.readWorkflows();
                    let target: { name: string; inputs: Workflow['inputs']; steps: WorkflowStep[] } | undefined;
                    if (definition) {
                        target = { name: definition.name, inputs: (definition.inputs ?? []) as Workflow['inputs'], steps: definition.steps as WorkflowStep[] };
                    } else if (nameOrId) {
                        const wf = WorkflowPlugin.find(workflows, nameOrId);
                        if (wf) target = wf;
                    }
                    if (!target) return { success: false, error: 'Provide a saved nameOrId or an inline definition.' };
                    const result = validateWorkflow(target, (n) => WorkflowPlugin.find(workflows, n));
                    return { success: true, ...result };
                },
            }),

            run_workflow: tool({
                description:
                    'Execute a saved workflow end-to-end with the given inputs. The engine makes the model calls, ' +
                    'flowing each step output into later steps, and returns the final output plus a per-step trace ' +
                    'and the number of model calls used.',
                inputSchema: z.object({
                    nameOrId: z.string(),
                    inputs: z.record(z.string(), z.any()).optional().describe('Bindings for the declared {{input.*}} — values may be strings, numbers, booleans, or JSON objects.'),
                }),
                execute: async ({ nameOrId, inputs }, { abortSignal } = {} as any) => {
                    // Prefer the dedicated (fast) workflow model when configured.
                    const runModel = this.workflowModel ?? this.model;
                    if (!runModel) {
                        return { success: false, error: 'No model available to run workflows.' };
                    }
                    const workflows = await this.readWorkflows();
                    const workflow = WorkflowPlugin.find(workflows, nameOrId);
                    if (!workflow) return { success: false, error: `No workflow "${nameOrId}". Use list_workflows.` };

                    const provided: Record<string, unknown> = inputs ?? {};
                    const missing = (workflow.inputs ?? [])
                        .filter((i) => {
                            if (!i.required || i.default !== undefined) return false;
                            const v = provided[i.name];
                            // undefined/null/'' is missing; 0 and false are valid values.
                            return v === undefined || v === null || v === '';
                        })
                        .map((i) => i.name);
                    if (missing.length) {
                        return {
                            success: false,
                            error: `Missing required input(s): ${missing.join(', ')}.`,
                            requiredInputs: workflow.inputs,
                        };
                    }

                    const op = this.createOperation('run-workflow', 'run_workflow');
                    op?.milestone(`Running workflow "${workflow.name}"`, { phase: 'run' });

                    const result = await runWorkflowToStream(workflow, {
                        model: runModel,
                        inputs: provided,
                        writer: this.writer,
                        abortSignal,
                        maxModelCalls: this.maxModelCalls,
                        workspaceDir: this.workspaceDir,
                        sandbox: this.sandbox,
                        resolveWorkflow: (n) => WorkflowPlugin.find(workflows, n),
                    });

                    if (result.success) {
                        op?.complete(
                            `Workflow "${workflow.name}" finished — ${result.modelCalls} model call${result.modelCalls === 1 ? '' : 's'}`,
                            { phase: 'complete' },
                        );
                    } else {
                        op?.fail(result.error ?? 'Workflow failed', { recoverable: true });
                    }
                    return result;
                },
            }),
        };
    }

    // ── prompt injection (library index, loaded from disk each turn) ──────────

    async modifySystemPrompt(prompt: string): Promise<string> {
        const workflows = await this.readWorkflows();

        let section = '\n\n# Workflows\n';
        section +=
            'You can define, save, and run reusable **workflows** — graphs of low-level AI SDK steps that the ' +
            'engine executes with real model calls, flowing each step output into later steps. Save a procedure ' +
            'once (`create_workflow`) and re-run it with new inputs (`run_workflow`) instead of re-deriving it.\n\n';
        section +=
            'Step kinds: `prompt` (one model call; ordered prompts form a chain), `route` (classify → run the ' +
            'matching branch), `parallel` (run branches concurrently, optional `aggregate`), `orchestrator` ' +
            '(plan subtasks → run workers → `synthesize`), `evaluator` (generate → score vs `criteria` → retry ' +
            'until `threshold`/`maxIterations`), `pipeline` (run a sequence of mixed-pattern `steps`), `workflow` ' +
            '(call another saved workflow), `action` (a side-effect with NO model call — `create_artifact` / ' +
            '`update_artifact` render a deliverable in the canvas, `write_file` saves to the workspace; its ' +
            '`params` are templated, so `content: "{{steps.draft}}"` turns a prior step into the artifact).\n';
        section +=
            '**Patterns compose (hybrids):** `aggregate`, `synthesize`, and an evaluator’s `generate` each accept ' +
            'ANY step kind, and a `pipeline` can sit in any slot — so you can route → an orchestrator, fan out ' +
            '`parallel` branches that are each a `pipeline` of [draft → evaluator], or evaluate-optimize a whole ' +
            'orchestrator. Reference data with `{{input.<name>}}` and `{{steps.<id>}}`; inside an evaluator’s ' +
            'generate, `{{feedback}}` is the latest critique. Use `validate_workflow` before running.\n';
        section +=
            '**Authoring big workflows:** `create_workflow` takes the whole definition as ONE argument, which is ' +
            'unreliable for large/deeply-nested workflows. For those, write the full JSON to a file with bash ' +
            "(`cat > my-workflow.json <<'EOF'` … `EOF`), then call `import_workflow({ path: \"my-workflow.json\" })`. " +
            'The file must be a complete workflow object: `{ name, description, inputs?, steps, tags? }`.\n';
        section +=
            '**Running a saved workflow needs NO file** — call `run_workflow({ nameOrId, inputs })` directly. To see ' +
            "what inputs to pass, use `list_workflows` (full input specs) or `get_workflow(nameOrId)` (its inputs + a " +
            'compact step outline). Do NOT search the filesystem for a saved workflow and do NOT `get_workflow(..., raw:true)` ' +
            'just to find the inputs — the default `get_workflow` already returns them.\n';
        section +=
            '**Run output:** a large `run_workflow` result is saved to a file under `workflow_runs/` and returned as ' +
            '`outputPath` + a short preview — read that file (e.g. `cat <outputPath>`) for the COMPLETE output and ' +
            'copy it where you need it. HTML/markdown outputs also render automatically in the canvas panel. Never ' +
            're-run a workflow just to recover its output.\n';

        section += `\n## Saved workflows — ${workflows.length}`;
        if (workflows.length === 0) {
            section += '\n_(none yet — author one with `create_workflow` when a multi-step procedure is worth reusing)_';
        } else {
            section += ' (run with `run_workflow(nameOrId, inputs)`)\n';
            section += [...workflows]
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .slice(0, MAX_INDEX_WORKFLOWS)
                .map((w) => {
                    const kinds = [...new Set(w.steps.map((s) => s.kind))].join('/');
                    const ins = w.inputs.map((i) => i.name).join(', ');
                    return `- **${w.name}** — ${w.description} · steps: ${w.steps.length} [${kinds}]${ins ? ` · inputs: ${ins}` : ''}`;
                })
                .join('\n');
            if (workflows.length > MAX_INDEX_WORKFLOWS) {
                section += `\n- …and ${workflows.length - MAX_INDEX_WORKFLOWS} more (use \`list_workflows\`)`;
            }
        }

        return prompt + section + '\n';
    }
}
