import { describe, expect, test } from 'bun:test';
import SubAgentPlugin from '../src/plugins/sub-agent';
import { BackgroundTaskRegistry, ConcurrencyLimitError } from '../src/plugins/background-tasks';
import type { Plugin, AgentHarnessConfig } from '../src/core/types';
import {
    completionSteps,
    createStreamResult,
    createTempWorkspace,
    createTool,
    recordCompletion,
    removeTempWorkspace,
} from './helpers';

function createBuiltInPlugins(): Plugin[] {
    return [{ name: 'BuiltInPlugin', tools: { readFile: createTool('readFile') } }];
}

/** A delegation whose completion we control, so we can observe the running state. */
function createPlugin(options: {
    workspaceDir: string;
    subAgents: Map<string, any>;
    gate?: Promise<void>;
    maxConcurrent?: number;
}) {
    return new SubAgentPlugin(
        options.subAgents,
        {} as any,
        () => createBuiltInPlugins(),
        () => ({}),
        [],
        options.workspaceDir,
        60 * 60 * 1000,
        options.maxConcurrent ?? 4,
        (config) => ({
            stream: () => (async () => {
                if (options.gate) await options.gate;
                await recordCompletion(config, 'done', ['src/example.ts'], { source: 'test' });
                return createStreamResult('done', completionSteps('done', ['src/example.ts']));
            })(),
        }) as any,
    );
}

const agents = () => new Map([
    ['Explorer', { name: 'Explorer', description: 'Explorer', systemPrompt: 'Explore.', tools: ['readFile'] }],
]);

describe('BackgroundTaskRegistry', () => {
    test('start returns immediately and settles the entry in place', async () => {
        const registry = new BackgroundTaskRegistry<string>(4);
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });

        const task = registry.start({
            id: 't1', agentName: 'A', task: 'work',
            run: async () => { await gate; return 'result'; },
            cancel: () => {},
        });

        expect(task.status).toBe('running');
        expect(registry.runningCount).toBe(1);

        release();
        const settled = await registry.await(['t1']);
        expect(settled[0].status).toBe('complete');
        expect(settled[0].result).toBe('result');
        expect(registry.runningCount).toBe(0);
    });

    test('a throwing run is recorded as failed, not propagated', async () => {
        const registry = new BackgroundTaskRegistry<string>(4);
        registry.start({
            id: 't1', agentName: 'A', task: 'work',
            run: async () => { throw new Error('boom'); },
            cancel: () => {},
        });

        // Must not reject — one bad task can't poison an await of many.
        const settled = await registry.await();
        expect(settled[0].status).toBe('failed');
        expect(settled[0].error).toBe('boom');
    });

    test('rejects a start past the concurrency cap', async () => {
        const registry = new BackgroundTaskRegistry<string>(1);
        const gate = new Promise<void>(() => {}); // never settles
        registry.start({ id: 't1', agentName: 'A', task: 'w', run: () => gate as Promise<string>, cancel: () => {} });

        expect(() => registry.start({
            id: 't2', agentName: 'A', task: 'w', run: () => gate as Promise<string>, cancel: () => {},
        })).toThrow(ConcurrencyLimitError);
    });

    test('cancel fires the task cancel handler only while running', async () => {
        const registry = new BackgroundTaskRegistry<string>(4);
        let cancelled = false;
        registry.start({
            id: 't1', agentName: 'A', task: 'w',
            run: async () => 'ok',
            cancel: () => { cancelled = true; },
        });
        await registry.await(['t1']);

        // Already settled — nothing to cancel.
        expect(registry.cancel('t1')).toBe(false);
        expect(cancelled).toBe(false);
        expect(registry.cancel('unknown')).toBe(false);
    });

    test('await ignores unknown ids rather than throwing', async () => {
        const registry = new BackgroundTaskRegistry<string>(4);
        registry.start({ id: 't1', agentName: 'A', task: 'w', run: async () => 'ok', cancel: () => {} });
        const settled = await registry.await(['t1', 'stale-id-from-an-earlier-turn']);
        expect(settled).toHaveLength(1);
    });
});

describe('SubAgentPlugin background delegation', () => {
    test('background delegate returns a task id without waiting for the result', async () => {
        const workspaceDir = await createTempWorkspace('bg-delegate');
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });

        try {
            const plugin = createPlugin({ workspaceDir, subAgents: agents(), gate });

            const started: any = await (plugin.tools.delegate as any).execute({
                agent_name: 'Explorer', task: 'Inspect', background: true,
            });

            expect(started.status).toBe('running');
            expect(started.taskId).toContain('Explorer');

            // Still in flight — check_tasks must not block.
            const mid: any = await (plugin.tools.check_tasks as any).execute({});
            expect(mid.running).toBe(1);
            expect(mid.tasks[0].status).toBe('running');

            release();
            const settled: any = await (plugin.tools.await_tasks as any).execute({ taskIds: [started.taskId] });
            expect(settled.tasks[0].status).toBe('complete');
            expect(settled.tasks[0].summary).toBe('done');
        } finally {
            await removeTempWorkspace(workspaceDir);
        }
    });

    test('background: false keeps the old blocking contract', async () => {
        const workspaceDir = await createTempWorkspace('bg-blocking');
        try {
            const plugin = createPlugin({ workspaceDir, subAgents: agents() });
            const result: any = await (plugin.tools.delegate as any).execute({
                agent_name: 'Explorer', task: 'Inspect', background: false,
            });
            // The result itself, not a handle.
            expect(result.status).toBe('completed');
            expect(result.summary).toBe('done');
        } finally {
            await removeTempWorkspace(workspaceDir);
        }
    });

    test('onBeforeFinish drains unsettled tasks so a result is never dropped', async () => {
        const workspaceDir = await createTempWorkspace('bg-drain');
        try {
            const plugin = createPlugin({ workspaceDir, subAgents: agents() });
            const started: any = await (plugin.tools.delegate as any).execute({
                agent_name: 'Explorer', task: 'Inspect', background: true,
            });

            // The model tried to finish while the delegation was outstanding.
            const injected = await plugin.onBeforeFinish();
            expect(injected).not.toBeNull();
            expect(injected![0].role).toBe('user');
            expect(injected![0].content).toContain(started.taskId);
            expect(injected![0].content).toContain('done');

            // Already reported — a second finish attempt must not re-inject it,
            // otherwise the loop would never terminate.
            expect(await plugin.onBeforeFinish()).toBeNull();
        } finally {
            await removeTempWorkspace(workspaceDir);
        }
    });

    test('onBeforeFinish is a no-op when nothing is outstanding', async () => {
        const workspaceDir = await createTempWorkspace('bg-noop');
        try {
            const plugin = createPlugin({ workspaceDir, subAgents: agents() });
            expect(await plugin.onBeforeFinish()).toBeNull();
        } finally {
            await removeTempWorkspace(workspaceDir);
        }
    });

    test('await_tasks marks results reported so the drain does not repeat them', async () => {
        const workspaceDir = await createTempWorkspace('bg-reported');
        try {
            const plugin = createPlugin({ workspaceDir, subAgents: agents() });
            const started: any = await (plugin.tools.delegate as any).execute({
                agent_name: 'Explorer', task: 'Inspect', background: true,
            });
            await (plugin.tools.await_tasks as any).execute({ taskIds: [started.taskId] });

            expect(await plugin.onBeforeFinish()).toBeNull();
        } finally {
            await removeTempWorkspace(workspaceDir);
        }
    });

    test('delegate reports capacity instead of throwing when the cap is hit', async () => {
        const workspaceDir = await createTempWorkspace('bg-capacity');
        const gate = new Promise<void>(() => {}); // never settles
        try {
            const plugin = createPlugin({ workspaceDir, subAgents: agents(), gate, maxConcurrent: 1 });

            await (plugin.tools.delegate as any).execute({ agent_name: 'Explorer', task: 'One', background: true });
            const second: any = await (plugin.tools.delegate as any).execute({ agent_name: 'Explorer', task: 'Two', background: true });

            expect(second.status).toBe('error');
            expect(second.error).toContain('Concurrent sub-agent limit reached');
        } finally {
            await removeTempWorkspace(workspaceDir);
        }
    });
});
