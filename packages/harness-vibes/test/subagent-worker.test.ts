import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ChildMessage, ParentMessage, SubAgentRunSpec } from '../src/plugins/subagent-protocol';

const WORKER = join(import.meta.dir, '..', 'src', 'plugins', 'subagent-worker.ts');

/**
 * A stub model factory written to disk, so the child's dynamic import of the
 * consumer's resolver is exercised for real rather than mocked away. Returns a
 * LanguageModelV2-shaped object that emits one text delta and stops.
 */
const RESOLVER_SOURCE = `
export function getModel(spec) {
  return {
    specificationVersion: 'v2',
    provider: 'stub',
    modelId: spec?.id ?? 'stub-model',
    supportedUrls: {},
    async doStream() {
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
            c.enqueue({ type: 'response-metadata', id: 'r1', modelId: 'stub-model', timestamp: new Date() });
            c.enqueue({ type: 'text-start', id: '0' });
            c.enqueue({ type: 'text-delta', id: '0', delta: 'stub answer' });
            c.enqueue({ type: 'text-end', id: '0' });
            c.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
            });
            c.close();
          },
        }),
      };
    },
  };
}
`;

async function withResolver<T>(fn: (dir: string, resolverPath: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'subagent-worker-'));
    const resolverPath = join(dir, 'stub-model.mjs');
    await writeFile(resolverPath, RESOLVER_SOURCE, 'utf8');
    try {
        return await fn(dir, resolverPath);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

function baseSpec(dir: string, resolverPath: string, over: Partial<SubAgentRunSpec> = {}): SubAgentRunSpec {
    return {
        resolverModule: resolverPath,
        resolverExport: 'getModel',
        modelSpec: { provider: 'stub', id: 'stub-model' },
        delegationId: 'Worker-1',
        agentName: 'Worker',
        systemPrompt: 'You are a worker.',
        task: 'Do the thing',
        maxSteps: 3,
        contextWindow: 128_000,
        compressionRatio: 0.7,
        workspaceDir: dir,
        stateDir: dir,
        depth: 1,
        maxDepth: 3,
        ...over,
    };
}

/** Spawn the worker, send a spec, collect messages until it settles. */
function runWorker(spec: SubAgentRunSpec, opts: { killAfterMs?: number } = {}) {
    return new Promise<{ messages: ChildMessage[]; exitCode: number | null }>((resolve) => {
        const messages: ChildMessage[] = [];
        const proc = Bun.spawn(['bun', WORKER], {
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
            env: process.env,
            ipc: (message: ChildMessage) => { messages.push(message); },
            onExit: (_p, exitCode) => resolve({ messages, exitCode }),
        });
        proc.send({ type: 'run', spec } satisfies ParentMessage);
        if (opts.killAfterMs != null) setTimeout(() => proc.kill(), opts.killAfterMs);
    });
}

describe('subagent worker (out-of-process)', () => {
    test('runs a delegation in a child process and returns an ExecutionResult', async () => {
        await withResolver(async (dir, resolverPath) => {
            const { messages } = await runWorker(baseSpec(dir, resolverPath));

            const done = messages.find((m) => m.type === 'done');
            const errored = messages.find((m) => m.type === 'error');
            expect(errored).toBeUndefined();
            expect(done).toBeDefined();
            expect((done as any).result.rawText).toBe('stub answer');
        });
    }, 30_000);

    test('forwards text deltas home so the parent can stream them', async () => {
        await withResolver(async (dir, resolverPath) => {
            const { messages } = await runWorker(baseSpec(dir, resolverPath));
            const deltas = messages.filter((m) => m.type === 'stream-part');
            expect(deltas.length).toBeGreaterThan(0);
            expect((deltas[0] as any).part.type).toBe('text-delta');
        });
    }, 30_000);

    test('reports a bad resolver export as an error instead of hanging', async () => {
        await withResolver(async (dir, resolverPath) => {
            const { messages } = await runWorker(
                baseSpec(dir, resolverPath, { resolverExport: 'noSuchExport' }),
            );
            const err = messages.find((m) => m.type === 'error');
            expect(err).toBeDefined();
            expect((err as any).message).toContain('noSuchExport');
        });
    }, 30_000);

    test('reports a missing resolver module as an error', async () => {
        await withResolver(async (dir) => {
            const { messages } = await runWorker(
                baseSpec(dir, join(dir, 'does-not-exist.mjs')),
            );
            expect(messages.find((m) => m.type === 'error')).toBeDefined();
            expect(messages.find((m) => m.type === 'done')).toBeUndefined();
        });
    }, 30_000);

    test('a killed child exits without reporting done (parent surfaces the failure)', async () => {
        await withResolver(async (dir, resolverPath) => {
            const { messages, exitCode } = await runWorker(
                baseSpec(dir, resolverPath),
                { killAfterMs: 0 },
            );
            expect(messages.find((m) => m.type === 'done')).toBeUndefined();
            expect(exitCode).not.toBe(0);
        });
    }, 30_000);
});
