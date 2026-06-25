import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import WorkflowPlugin from '../src/plugins/workflow';
import { WorkflowEngine, validateWorkflow, type Workflow, type WorkflowStep } from '../src/plugins/workflow-engine';
import { createPluginStreamContext, createDataStreamWriter } from '../src/core/types';
import { LocalSandbox } from '../src/sandbox/local-sandbox';
import { createCapturingWriter, createTempWorkspace, removeTempWorkspace } from './helpers';

// ── mock-model helpers ───────────────────────────────────────────────────────

function mk(text: string) {
    return {
        finishReason: { type: 'stop', unified: 'stop' },
        content: [{ type: 'text', text }],
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
        providerMetadata: undefined,
    } as any;
}

/** The engine now uses streamText, so the mocks must answer doStream too. One
 *  text-delta carrying the whole response keeps the assertions identical. */
function mkStream(text: string) {
    return {
        stream: simulateReadableStream({
            chunks: [
                { type: 'stream-start', warnings: [] },
                { type: 'text-start', id: '0' },
                { type: 'text-delta', id: '0', delta: text },
                { type: 'text-end', id: '0' },
                { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
            ],
        }),
    } as any;
}

/** Extract just the user-message text from a recorded doGenerate call. */
function promptText(options: any): string {
    const parts: string[] = [];
    for (const m of options?.prompt ?? []) {
        if (m.role !== 'user') continue;
        if (typeof m.content === 'string') parts.push(m.content);
        else for (const p of m.content ?? []) if (p?.type === 'text') parts.push(p.text);
    }
    return parts.join('\n');
}

/** All text (system + user + …) of a recorded call, for content-keyed matching. */
function allText(options: any): string {
    const parts: string[] = [];
    for (const m of options?.prompt ?? []) {
        if (typeof m.content === 'string') parts.push(m.content);
        else for (const p of m.content ?? []) if (p?.type === 'text') parts.push(p.text);
    }
    return parts.join('\n');
}

/** Deterministic sequential model: returns responses in order (clamps to last). */
function queueModel(responses: string[]) {
    const calls: any[] = [];
    let i = 0;
    const next = (options: any) => {
        calls.push(options);
        const text = responses[Math.min(i, responses.length - 1)];
        i++;
        return text;
    };
    const model = new MockLanguageModelV3({
        doGenerate: async (options: any) => mk(next(options)),
        doStream: async (options: any) => mkStream(next(options)),
    });
    return { model, calls };
}

/** Content-keyed model: first matching rule wins (robust to concurrency). */
function keyedModel(rules: Array<[RegExp, string]>, fallback = '') {
    const calls: any[] = [];
    const pick = (options: any) => {
        calls.push(options);
        const text = allText(options);
        const hit = rules.find(([re]) => re.test(text));
        return hit ? hit[1] : fallback;
    };
    const model = new MockLanguageModelV3({
        doGenerate: async (options: any) => mk(pick(options)),
        doStream: async (options: any) => mkStream(pick(options)),
    });
    return { model, calls };
}

function makeWorkflow(steps: WorkflowStep[], inputs: Workflow['inputs'] = []): Workflow {
    return {
        id: 'wf_test',
        name: 'test',
        description: 'test workflow',
        tags: [],
        inputs,
        steps,
        createdAt: 'now',
        updatedAt: 'now',
        version: 1,
    };
}

// ── engine: the five AI SDK patterns ─────────────────────────────────────────

describe('WorkflowEngine', () => {
    test('sequential chain flows each step output into the next prompt', async () => {
        const { model, calls } = queueModel(['DRAFT-TEXT', 'IMPROVED-TEXT']);
        const engine = new WorkflowEngine(model as any);
        const wf = makeWorkflow(
            [
                { id: 'draft', kind: 'prompt', prompt: 'Write about {{input.topic}}' },
                { id: 'refine', kind: 'prompt', prompt: 'Improve this:\n{{steps.draft}}' },
            ],
            [{ name: 'topic' }],
        );

        const result = await engine.run(wf, { topic: 'otters' });

        expect(result.success).toBe(true);
        expect(result.finalOutput).toBe('IMPROVED-TEXT');
        expect(result.modelCalls).toBe(2);
        expect(promptText(calls[0])).toContain('otters');     // input interpolated
        expect(promptText(calls[1])).toContain('DRAFT-TEXT');  // prior step interpolated
        expect(result.trace.map((t) => t.stepId)).toEqual(['draft', 'refine']);
    });

    test('parallel branches run and the aggregate sees both outputs', async () => {
        const { model, calls } = keyedModel([
            [/Combine/, 'COMBINED'],
            [/Task A/, 'RESULT_A'],
            [/Task B/, 'RESULT_B'],
        ]);
        const engine = new WorkflowEngine(model as any);
        const wf = makeWorkflow([
            {
                id: 'fan',
                kind: 'parallel',
                branches: [
                    { id: 'a', kind: 'prompt', prompt: 'Task A' },
                    { id: 'b', kind: 'prompt', prompt: 'Task B' },
                ],
                aggregate: { id: 'agg', kind: 'prompt', prompt: 'Combine {{steps.a}} and {{steps.b}}' },
            },
        ]);

        const result = await engine.run(wf, {});

        expect(result.success).toBe(true);
        expect(result.finalOutput).toBe('COMBINED');
        const aggCall = calls.find((c) => /Combine/.test(allText(c)));
        expect(promptText(aggCall)).toContain('RESULT_A');
        expect(promptText(aggCall)).toContain('RESULT_B');
    });

    test('route classifies and runs only the matching branch', async () => {
        const { model, calls } = keyedModel([
            [/classifier/i, '{"choice":"tech","reason":"a code error"}'],
            [/Tech answer/, 'TECH_RESULT'],
            [/Billing answer/, 'BILLING_RESULT'],
        ]);
        const engine = new WorkflowEngine(model as any);
        const wf = makeWorkflow([
            {
                id: 'router',
                kind: 'route',
                prompt: 'My code throws an error',
                routes: [
                    { when: 'billing', step: { id: 'bill', kind: 'prompt', prompt: 'Billing answer' } },
                    { when: 'tech', step: { id: 'tech', kind: 'prompt', prompt: 'Tech answer' } },
                ],
            },
        ]);

        const result = await engine.run(wf, {});

        expect(result.success).toBe(true);
        expect(result.finalOutput).toBe('TECH_RESULT');
        expect(calls.some((c) => /Billing answer/.test(allText(c)))).toBe(false); // billing never ran
    });

    test('orchestrator plans subtasks, runs workers, and synthesizes', async () => {
        // Order matters: the synthesize prompt embeds the plan (which contains
        // "do alpha"/"do beta"), so match /Synthesize/ before the worker rules.
        const { model, calls } = keyedModel([
            [/orchestrator/i, '{"subtasks":[{"title":"A","prompt":"do alpha"},{"title":"B","prompt":"do beta"}]}'],
            [/Synthesize/, 'FINAL_SYNTHESIS'],
            [/do alpha/, 'ALPHA_DONE'],
            [/do beta/, 'BETA_DONE'],
        ]);
        const engine = new WorkflowEngine(model as any);
        const wf = makeWorkflow([
            {
                id: 'orch',
                kind: 'orchestrator',
                objective: 'Build the thing',
                synthesize: { id: 'syn', kind: 'prompt', prompt: 'Synthesize {{steps.orch}}' },
            },
        ]);

        const result = await engine.run(wf, {});

        expect(result.success).toBe(true);
        expect(result.finalOutput).toBe('FINAL_SYNTHESIS');
        // both workers ran
        expect(calls.some((c) => /do alpha/.test(allText(c)))).toBe(true);
        expect(calls.some((c) => /do beta/.test(allText(c)))).toBe(true);
        // synthesis saw the worker outputs
        const synCall = calls.find((c) => /Synthesize/.test(allText(c)));
        expect(promptText(synCall)).toContain('ALPHA_DONE');
        expect(promptText(synCall)).toContain('BETA_DONE');
    });

    test('evaluator loops until the threshold then returns the best output', async () => {
        const { model, calls } = queueModel([
            'draft-1',
            '{"score":6,"feedback":"add detail"}',
            'draft-2',
            '{"score":9,"feedback":"great"}',
        ]);
        const engine = new WorkflowEngine(model as any);
        const wf = makeWorkflow(
            [
                {
                    id: 'opt',
                    kind: 'evaluator',
                    generate: { id: 'gen', kind: 'prompt', prompt: 'Write a haiku about {{input.topic}}' },
                    criteria: 'vivid imagery',
                    threshold: 8,
                    maxIterations: 3,
                },
            ],
            [{ name: 'topic' }],
        );

        const result = await engine.run(wf, { topic: 'rain' });

        expect(result.success).toBe(true);
        expect(result.finalOutput).toBe('draft-2');
        expect(result.modelCalls).toBe(4); // 2 generate + 2 evaluate
        expect(promptText(calls[2])).toContain('add detail'); // feedback fed back in
    });

    test('evaluator stops at maxIterations even below threshold', async () => {
        const { model } = queueModel([
            'd1', '{"score":3,"feedback":"meh"}',
            'd2', '{"score":3,"feedback":"meh"}',
            'd3', '{"score":3,"feedback":"meh"}',
        ]);
        const engine = new WorkflowEngine(model as any);
        const wf = makeWorkflow([
            {
                id: 'opt',
                kind: 'evaluator',
                generate: { id: 'g', kind: 'prompt', prompt: 'go' },
                criteria: 'x',
                threshold: 8,
                maxIterations: 2,
            },
        ]);

        const result = await engine.run(wf, {});

        expect(result.success).toBe(true);
        expect(result.modelCalls).toBe(4); // capped at 2 iterations × 2 calls
        expect(result.finalOutput).toBe('d1'); // ties keep the first
    });

    test('pipeline runs mixed steps in sequence and returns the last output', async () => {
        const { model, calls } = queueModel(['STEP_ONE', 'STEP_TWO']);
        const engine = new WorkflowEngine(model as any);
        const wf = makeWorkflow([
            {
                id: 'pipe',
                kind: 'pipeline',
                steps: [
                    { id: 'one', kind: 'prompt', prompt: 'do one' },
                    { id: 'two', kind: 'prompt', prompt: 'use {{steps.one}}' },
                ],
            },
        ]);

        const result = await engine.run(wf, {});

        expect(result.success).toBe(true);
        expect(result.finalOutput).toBe('STEP_TWO');
        expect(promptText(calls[1])).toContain('STEP_ONE'); // chained inside the pipeline
    });

    test('hybrid: an evaluator optimizes a pipeline, threading {{feedback}}', async () => {
        // generate is itself a [outline → draft] pipeline; the draft reads the
        // latest critique via {{feedback}}. Iteration 1 scores 6, iteration 2 scores 9.
        const { model, calls } = queueModel([
            'OUTLINE-1',
            'DRAFT-1',
            '{"score":6,"feedback":"tighten it"}',
            'OUTLINE-2',
            'DRAFT-2',
            '{"score":9,"feedback":"great"}',
        ]);
        const engine = new WorkflowEngine(model as any);
        const wf = makeWorkflow([
            {
                id: 'opt',
                kind: 'evaluator',
                criteria: 'tight and clear',
                threshold: 8,
                maxIterations: 3,
                generate: {
                    id: 'gen',
                    kind: 'pipeline',
                    steps: [
                        { id: 'outline', kind: 'prompt', prompt: 'Outline a post' },
                        { id: 'draft', kind: 'prompt', prompt: 'Draft from {{steps.outline}}. Address feedback: {{feedback}}' },
                    ],
                },
            },
        ]);

        const result = await engine.run(wf, {});

        expect(result.success).toBe(true);
        expect(result.finalOutput).toBe('DRAFT-2'); // pipeline's last step, best iteration
        expect(result.modelCalls).toBe(6); // (outline + draft + eval) × 2
        expect(promptText(calls[4])).toContain('tighten it'); // iter-2 draft saw the critique
    });

    test('evaluator degrades gracefully when the scorer returns non-JSON prose', async () => {
        // Reproduces the real-world failure: a model with no structured-output
        // support returns prose, not JSON, for the score step. The run must
        // still SUCCEED (return the best draft), not hard-fail on a parse error.
        const { model } = keyedModel(
            [[/evaluator/i, 'This is pretty good, about 7 out of 10 honestly.']], // prose, not JSON
            'A SNAPPY TAGLINE', // fallback = the generate step's output
        );
        const engine = new WorkflowEngine(model as any);
        const wf = makeWorkflow(
            [
                {
                    id: 'opt',
                    kind: 'evaluator',
                    generate: { id: 'gen', kind: 'prompt', prompt: 'Write a tagline for {{input.product}}' },
                    criteria: 'memorable',
                    threshold: 8,
                    maxIterations: 2,
                },
            ],
            [{ name: 'product' }],
        );

        const result = await engine.run(wf, { product: 'a smart thermostat' });

        expect(result.success).toBe(true);
        expect(result.finalOutput).toBe('A SNAPPY TAGLINE');
    });

    test('enforces the per-run model-call budget', async () => {
        const { model } = queueModel(['a', 'b', 'c']);
        const engine = new WorkflowEngine(model as any, { maxModelCalls: 2 });
        const wf = makeWorkflow([
            { id: 's1', kind: 'prompt', prompt: 'one' },
            { id: 's2', kind: 'prompt', prompt: 'two' },
            { id: 's3', kind: 'prompt', prompt: 'three' },
        ]);

        const result = await engine.run(wf, {});

        expect(result.success).toBe(false);
        expect(result.error).toContain('budget');
        expect(result.modelCalls).toBe(2);
    });
});

// ── engine: action steps (side-effects, no model call) ───────────────────────

describe('WorkflowEngine — actions', () => {
    test('create_artifact writes the file and streams a data-artifact part', async () => {
        const dir = await createTempWorkspace('wf-action');
        try {
            const { model } = queueModel(['# Hello\n\nDrafted body.']);
            const parts: any[] = [];
            const engine = new WorkflowEngine(model as any);
            const wf = makeWorkflow(
                [
                    { id: 'draft', kind: 'prompt', prompt: 'Write a doc about {{input.topic}}' },
                    { id: 'publish', kind: 'action', action: 'create_artifact', params: { title: 'My Doc', kind: 'markdown', content: '{{steps.draft}}' } },
                ],
                [{ name: 'topic' }],
            );

            const result = await engine.run(wf, { topic: 'otters' }, {
                writer: createDataStreamWriter(createCapturingWriter(parts)),
                sandbox: new LocalSandbox(dir),
            });

            expect(result.success).toBe(true);
            expect(result.modelCalls).toBe(1); // the action makes no model call

            const artifact = parts.find((p) => p.type === 'data-artifact');
            expect(artifact).toBeTruthy();
            expect(artifact.data.kind).toBe('markdown');
            expect(artifact.data.content).toContain('Drafted body.'); // prior step interpolated
            expect(artifact.data.version).toBe(1);

            const onDisk = await readFile(join(dir, artifact.data.path), 'utf8');
            expect(onDisk).toContain('Drafted body.'); // persisted to the sandbox

            const out: any = result.finalOutput;
            expect(out.action).toBe('create_artifact');
            expect(typeof out.id).toBe('string');
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('update_artifact bumps the version of an artifact made earlier in the run', async () => {
        const dir = await createTempWorkspace('wf-action-update');
        try {
            const { model } = queueModel(['v1 body', 'v2 body']);
            const parts: any[] = [];
            const engine = new WorkflowEngine(model as any);
            const wf = makeWorkflow([
                { id: 'd1', kind: 'prompt', prompt: 'draft one' },
                { id: 'make', kind: 'action', action: 'create_artifact', params: { title: 'Doc', kind: 'markdown', content: '{{steps.d1}}' } },
                { id: 'd2', kind: 'prompt', prompt: 'draft two' },
                { id: 'revise', kind: 'action', action: 'update_artifact', params: { id: '{{steps.make.id}}', content: '{{steps.d2}}' } },
            ]);

            const result = await engine.run(wf, {}, {
                writer: createDataStreamWriter(createCapturingWriter(parts)),
                sandbox: new LocalSandbox(dir),
            });

            expect(result.success).toBe(true);
            const artifacts = parts.filter((p) => p.type === 'data-artifact');
            expect(artifacts.length).toBe(2);
            expect(artifacts[0].data.version).toBe(1);
            expect(artifacts[1].data.version).toBe(2);
            expect(artifacts[1].data.content).toContain('v2 body');
            expect(artifacts[1].data.id).toBe(artifacts[0].data.id); // same artifact, updated in place
            expect(artifacts[1].data.path).toBe(artifacts[0].data.path);
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('write_file persists an interpolated file with no model call', async () => {
        const dir = await createTempWorkspace('wf-action-file');
        try {
            const { model } = queueModel(['ESSAY-BODY']);
            const engine = new WorkflowEngine(model as any);
            const wf = makeWorkflow([
                { id: 'write', kind: 'prompt', prompt: 'write an essay' },
                { id: 'save', kind: 'action', action: 'write_file', params: { path: 'out/essay.txt', content: '{{steps.write}}' } },
            ]);

            const result = await engine.run(wf, {}, { sandbox: new LocalSandbox(dir) });

            expect(result.success).toBe(true);
            expect(result.modelCalls).toBe(1);
            const onDisk = await readFile(join(dir, 'out/essay.txt'), 'utf8');
            expect(onDisk).toBe('ESSAY-BODY');
            expect((result.finalOutput as any).action).toBe('write_file');
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('validateWorkflow flags an unknown action', () => {
        const wf = makeWorkflow([{ id: 'bad', kind: 'action', action: 'nuke_everything' as any, params: {} }]);
        const res = validateWorkflow(wf);
        expect(res.valid).toBe(false);
        expect(res.errors.join(' ')).toContain('unknown action');
    });
});

// ── plugin: library, persistence, validation, run ────────────────────────────

describe('WorkflowPlugin', () => {
    test('create_workflow saves, lists, indexes, and emits a saved part', async () => {
        const dir = await createTempWorkspace('wf-create');
        try {
            const parts: any[] = [];
            const plugin = new WorkflowPlugin(queueModel(['x']).model as any, { workflowsPath: join(dir, 'workflows.json') });
            plugin.onStreamContextReady(createPluginStreamContext(createCapturingWriter(parts)));
            await plugin.waitReady();

            const res: any = await (plugin.tools.create_workflow as any).execute({
                name: 'draft-and-refine',
                description: 'Draft then improve copy',
                inputs: [{ name: 'topic', required: true }],
                steps: [
                    { id: 'draft', kind: 'prompt', prompt: 'Write about {{input.topic}}' },
                    { id: 'refine', kind: 'prompt', prompt: 'Improve: {{steps.draft}}' },
                ],
            });
            expect(res.success).toBe(true);
            expect(res.stepCount).toBe(2);

            const onDisk = JSON.parse(await readFile(join(dir, 'workflows.json'), 'utf8'));
            expect(onDisk).toHaveLength(1);
            expect(onDisk[0].name).toBe('draft-and-refine');

            const list: any = await (plugin.tools.list_workflows as any).execute({});
            expect(list.count).toBe(1);
            expect(list.workflows[0].name).toBe('draft-and-refine');

            const prompt = await plugin.modifySystemPrompt('BASE');
            expect(prompt).toContain('# Workflows');
            expect(prompt).toContain('draft-and-refine');

            const saved = parts.find((p) => p.type === 'data-workflow' && p.data.action === 'saved');
            expect(saved).toBeDefined();
            expect(saved.data.name).toBe('draft-and-refine');
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('create_workflow rejects a duplicate name unless overwrite', async () => {
        const dir = await createTempWorkspace('wf-dup');
        try {
            const plugin = new WorkflowPlugin(undefined, { workflowsPath: join(dir, 'workflows.json') });
            await plugin.waitReady();
            const def = { name: 'dup', description: 'd', steps: [{ id: 's', kind: 'prompt', prompt: 'hi' }] };

            const first: any = await (plugin.tools.create_workflow as any).execute(def);
            expect(first.success).toBe(true);

            const second: any = await (plugin.tools.create_workflow as any).execute(def);
            expect(second.success).toBe(false);
            expect(second.error).toContain('already exists');

            const overwritten: any = await (plugin.tools.create_workflow as any).execute({ ...def, overwrite: true });
            expect(overwritten.success).toBe(true);
            expect(overwritten.version).toBe(2);
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('validate_workflow reports errors and warnings without running', async () => {
        const dir = await createTempWorkspace('wf-validate');
        try {
            const plugin = new WorkflowPlugin(undefined, { workflowsPath: join(dir, 'workflows.json') });
            await plugin.waitReady();

            const res: any = await (plugin.tools.validate_workflow as any).execute({
                definition: {
                    name: 'bad',
                    inputs: [],
                    steps: [
                        { id: 'a', kind: 'prompt', prompt: 'refers to {{steps.ghost}}' },
                        { id: 'a', kind: 'prompt', prompt: 'duplicate id' },
                    ],
                },
            });

            expect(res.success).toBe(true);
            expect(res.valid).toBe(false);
            expect(res.errors.join(' ')).toContain('duplicate step id');
            expect(res.warnings.join(' ')).toContain('ghost');
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('run_workflow refuses to run without a required input', async () => {
        const dir = await createTempWorkspace('wf-required');
        try {
            const plugin = new WorkflowPlugin(queueModel(['x']).model as any, { workflowsPath: join(dir, 'workflows.json') });
            await plugin.waitReady();
            await (plugin.tools.create_workflow as any).execute({
                name: 'needs-topic',
                description: 'd',
                inputs: [{ name: 'topic', required: true }],
                steps: [{ id: 's', kind: 'prompt', prompt: '{{input.topic}}' }],
            });

            const res: any = await (plugin.tools.run_workflow as any).execute({ nameOrId: 'needs-topic', inputs: {} });
            expect(res.success).toBe(false);
            expect(res.error).toContain('topic');
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('run_workflow executes and emits the run lifecycle parts', async () => {
        const dir = await createTempWorkspace('wf-run');
        try {
            const parts: any[] = [];
            const plugin = new WorkflowPlugin(queueModel(['ONLY-STEP']).model as any, { workflowsPath: join(dir, 'workflows.json') });
            plugin.onStreamContextReady(createPluginStreamContext(createCapturingWriter(parts)));
            await plugin.waitReady();
            await (plugin.tools.create_workflow as any).execute({
                name: 'simple',
                description: 'd',
                steps: [{ id: 'only', kind: 'prompt', prompt: 'hello' }],
            });

            const res: any = await (plugin.tools.run_workflow as any).execute({ nameOrId: 'simple' });
            expect(res.success).toBe(true);
            expect(res.finalOutput).toBe('ONLY-STEP');
            expect(res.modelCalls).toBe(1);

            // The run streams an accumulating snapshot: status running → complete.
            const runParts = parts.filter((p) => p.type === 'data-workflow' && p.data.action === 'run');
            const statuses = runParts.map((p) => p.data.status);
            expect(statuses).toContain('running');
            expect(statuses).toContain('complete');

            // The final snapshot lists the executed step as complete, with a
            // fuller `detail` for the expandable UI view.
            const final = runParts[runParts.length - 1];
            expect(final.data.steps.map((s: any) => s.id)).toContain('only');
            expect(final.data.steps[0].status).toBe('complete');
            expect(final.data.steps[0].detail).toContain('ONLY-STEP');
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('run_workflow coerces typed inputs (number / boolean / json) and supports json dot-paths', async () => {
        const dir = await createTempWorkspace('wf-typed');
        try {
            const { model, calls } = queueModel(['ok']);
            const plugin = new WorkflowPlugin(model as any, { workflowsPath: join(dir, 'workflows.json'), workspaceDir: dir });
            await plugin.waitReady();
            await (plugin.tools.create_workflow as any).execute({
                name: 'typed',
                description: 'd',
                inputs: [
                    { name: 'count', type: 'number', required: true },
                    { name: 'flag', type: 'boolean' },
                    { name: 'cfg', type: 'json' },
                ],
                steps: [{ id: 's', kind: 'prompt', prompt: 'count={{input.count}} flag={{input.flag}} color={{input.cfg.color}}' }],
            });

            // Values arrive as strings (e.g. from a tool call) and are coerced to type.
            const res: any = await (plugin.tools.run_workflow as any).execute({
                nameOrId: 'typed',
                inputs: { count: '3', flag: 'true', cfg: '{"color":"red"}' },
            });
            expect(res.success).toBe(true);

            const prompt = promptText(calls[0]);
            expect(prompt).toContain('count=3'); // number, not "3"
            expect(prompt).toContain('flag=true'); // boolean
            expect(prompt).toContain('color=red'); // json object, dot-addressed
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('run_workflow supports the array type (comma-separated or JSON list)', async () => {
        const dir = await createTempWorkspace('wf-array');
        try {
            const { model, calls } = queueModel(['ok', 'ok']);
            const plugin = new WorkflowPlugin(model as any, { workflowsPath: join(dir, 'workflows.json'), workspaceDir: dir });
            await plugin.waitReady();
            await (plugin.tools.create_workflow as any).execute({
                name: 'arr',
                description: 'd',
                inputs: [{ name: 'sections', type: 'array', required: true }],
                steps: [{ id: 's', kind: 'prompt', prompt: 'list={{input.sections}} first={{input.sections.0}}' }],
            });

            // A comma-separated string → string[]; renders as a readable list; indexable.
            const r1: any = await (plugin.tools.run_workflow as any).execute({ nameOrId: 'arr', inputs: { sections: 'hero, about, contact' } });
            expect(r1.success).toBe(true);
            const p1 = promptText(calls[0]);
            expect(p1).toContain('list=hero, about, contact');
            expect(p1).toContain('first=hero');

            // An actual array passed through (e.g. directly from the tool call).
            const r2: any = await (plugin.tools.run_workflow as any).execute({ nameOrId: 'arr', inputs: { sections: ['x', 'y'] } });
            expect(r2.success).toBe(true);
            expect(promptText(calls[1])).toContain('list=x, y');
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('get_workflow returns a compact interface (inputs + outline), not the giant body', async () => {
        const dir = await createTempWorkspace('wf-interface');
        try {
            const plugin = new WorkflowPlugin(undefined, { workflowsPath: join(dir, 'workflows.json') });
            await plugin.waitReady();
            const longPrompt = 'P'.repeat(500);
            await (plugin.tools.create_workflow as any).execute({
                name: 'iface',
                description: 'd',
                inputs: [{ name: 'topic', description: 'the topic', required: true }],
                steps: [{ id: 'only', kind: 'prompt', title: 'Step', prompt: longPrompt }],
            });

            // list_workflows → FULL input specs (not just names).
            const list: any = await (plugin.tools.list_workflows as any).execute({});
            const entry = list.workflows.find((w: any) => w.name === 'iface');
            expect(entry.inputs[0].name).toBe('topic');
            expect(entry.inputs[0].required).toBe(true);

            // get_workflow (compact) → inputs + truncated outline + runWith; no giant body.
            const compact: any = await (plugin.tools.get_workflow as any).execute({ nameOrId: 'iface' });
            expect(compact.inputs[0].name).toBe('topic');
            expect(compact.outline[0].id).toBe('only');
            expect(compact.outline[0].prompt.length).toBeLessThan(longPrompt.length);
            expect(compact.runWith).toContain('run_workflow');
            expect(compact.workflow).toBeUndefined();

            // raw → the full definition.
            const raw: any = await (plugin.tools.get_workflow as any).execute({ nameOrId: 'iface', raw: true });
            expect(raw.workflow.steps[0].prompt.length).toBe(longPrompt.length);
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('run_workflow saves a large output to a file instead of returning it inline', async () => {
        const dir = await createTempWorkspace('wf-bigout');
        try {
            const big = 'X'.repeat(5000);
            const plugin = new WorkflowPlugin(queueModel([big]).model as any, {
                workflowsPath: join(dir, 'workflows.json'),
                workspaceDir: dir,
            });
            await plugin.waitReady();
            await (plugin.tools.create_workflow as any).execute({
                name: 'big',
                description: 'd',
                steps: [{ id: 'only', kind: 'prompt', prompt: 'go' }],
            });

            const res: any = await (plugin.tools.run_workflow as any).execute({ nameOrId: 'big' });
            expect(res.success).toBe(true);
            expect(res.outputChars).toBe(5000);
            expect(res.outputPath).toContain('workflow_runs/');
            expect(res.finalOutput).toBeUndefined(); // not inline — would be clipped by compression

            // The complete output is on disk, unclipped.
            const saved = await readFile(join(dir, res.outputPath), 'utf8');
            expect(saved.length).toBe(5000);
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('run_workflow renders a large HTML output as a canvas artifact', async () => {
        const dir = await createTempWorkspace('wf-artifact');
        try {
            const parts: any[] = [];
            const html = `<!DOCTYPE html><html><body>${'y'.repeat(3000)}</body></html>`;
            const plugin = new WorkflowPlugin(queueModel([html]).model as any, {
                workflowsPath: join(dir, 'workflows.json'),
                workspaceDir: dir,
            });
            plugin.onStreamContextReady(createPluginStreamContext(createCapturingWriter(parts)));
            await plugin.waitReady();
            await (plugin.tools.create_workflow as any).execute({
                name: 'site',
                description: 'd',
                steps: [{ id: 'only', kind: 'prompt', prompt: 'go' }],
            });

            const res: any = await (plugin.tools.run_workflow as any).execute({ nameOrId: 'site' });
            expect(res.success).toBe(true);
            expect(res.outputPath).toContain('.html');
            expect(res.rendered).toBe(true);

            const artifact = parts.find((p) => p.type === 'data-artifact');
            expect(artifact).toBeDefined();
            expect(artifact.data.kind).toBe('html');
            expect(artifact.data.content.length).toBe(html.length);
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('import_workflow saves a definition the agent wrote to a file', async () => {
        // The reliable path for large workflows: the model writes JSON to a file
        // via bash, then imports it — instead of passing a giant nested argument.
        const dir = await createTempWorkspace('wf-import');
        try {
            const plugin = new WorkflowPlugin(undefined, { workflowsPath: join(dir, 'workflows.json'), workspaceDir: dir });
            await plugin.waitReady();

            const def = {
                name: 'imported-wf',
                description: 'authored as a file',
                tags: ['x'],
                inputs: [{ name: 'topic', required: true }],
                steps: [
                    { id: 'a', kind: 'prompt', prompt: 'Write about {{input.topic}}' },
                    { id: 'b', kind: 'prompt', prompt: 'Improve {{steps.a}}' },
                ],
            };
            await writeFile(join(dir, 'wf.json'), JSON.stringify(def), 'utf8');

            // Path is workspace-root-relative (leading "/" matches the shell cwd).
            const res: any = await (plugin.tools.import_workflow as any).execute({ path: '/wf.json' });
            expect(res.success).toBe(true);
            expect(res.name).toBe('imported-wf');
            expect(res.stepCount).toBe(2);

            const list: any = await (plugin.tools.list_workflows as any).execute({});
            expect(list.workflows.map((w: any) => w.name)).toContain('imported-wf');
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('import_workflow accepts a raw json string and reports bad json / missing files', async () => {
        const dir = await createTempWorkspace('wf-import-json');
        try {
            const plugin = new WorkflowPlugin(undefined, { workflowsPath: join(dir, 'workflows.json'), workspaceDir: dir });
            await plugin.waitReady();

            const ok: any = await (plugin.tools.import_workflow as any).execute({
                json: JSON.stringify({ name: 'json-wf', description: 'd', steps: [{ id: 's', kind: 'prompt', prompt: 'hi' }] }),
            });
            expect(ok.success).toBe(true);
            expect(ok.name).toBe('json-wf');

            const bad: any = await (plugin.tools.import_workflow as any).execute({ json: '{ not valid' });
            expect(bad.success).toBe(false);
            expect(bad.error).toContain('not valid JSON');

            const missing: any = await (plugin.tools.import_workflow as any).execute({ path: 'nope.json' });
            expect(missing.success).toBe(false);
            expect(missing.error).toContain('Could not read');
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('run_workflow composes a saved sub-workflow step', async () => {
        const dir = await createTempWorkspace('wf-compose');
        try {
            const { model } = keyedModel([
                [/CHILD does/, 'CHILD_OUT'],
                [/Parent saw/, 'PARENT_OUT'],
            ]);
            const plugin = new WorkflowPlugin(model as any, { workflowsPath: join(dir, 'workflows.json') });
            await plugin.waitReady();

            await (plugin.tools.create_workflow as any).execute({
                name: 'child',
                description: 'child wf',
                inputs: [{ name: 'x' }],
                steps: [{ id: 'cs', kind: 'prompt', prompt: 'CHILD does {{input.x}}' }],
            });
            await (plugin.tools.create_workflow as any).execute({
                name: 'parent',
                description: 'parent wf',
                steps: [
                    { id: 'call', kind: 'workflow', workflowName: 'child', inputs: { x: 'thing' } },
                    { id: 'after', kind: 'prompt', prompt: 'Parent saw {{steps.call}}' },
                ],
            });

            const res: any = await (plugin.tools.run_workflow as any).execute({ nameOrId: 'parent' });
            expect(res.success).toBe(true);
            expect(res.finalOutput).toBe('PARENT_OUT');
        } finally {
            await removeTempWorkspace(dir);
        }
    });
});
