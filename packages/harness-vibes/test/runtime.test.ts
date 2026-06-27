import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { join } from 'path';
import { defineAgent, createRuntime } from '../index';
import { LocalSandbox } from '../src/sandbox/local-sandbox';
import { createTempWorkspace, removeTempWorkspace } from './helpers';

function textModel(text: string) {
    return new MockLanguageModelV3({
        doGenerate: async () => ({
            finishReason: { type: 'stop', unified: 'stop' },
            content: [{ type: 'text', text }],
            usage: { inputTokens: { total: 5 }, outputTokens: { total: 7 } },
            warnings: [],
            providerMetadata: undefined,
        } as any),
    });
}

describe('Public harness facade', () => {
    test('defineAgent returns the definition unchanged', () => {
        const def = { model: textModel('hi') as any, skipDefaultPlugins: true };
        expect(defineAgent(def)).toBe(def);
    });

    test('ephemeral session.prompt returns the agent text answer', async () => {
        const root = await createTempWorkspace('harness-prompt');
        try {
            const harness = createRuntime({
                model: textModel('The answer is 42.') as any,
                skipDefaultPlugins: true,
                workspaceDir: root,
            });

            // persist:false → no SQLite, no caching; pure one-shot.
            const session = await harness.session({ persist: false });
            const result = await session.prompt('What is the answer?');

            expect(result.text).toBe('The answer is 42.');
            expect(result.steps).toBeGreaterThanOrEqual(1);
            expect(result.usage.totalTokens).toBeGreaterThanOrEqual(0);
            expect(Array.isArray(result.state.messages)).toBe(true);
        } finally {
            await removeTempWorkspace(root);
        }
    });

    test('a sandbox passed to createRuntime is adopted as the workspace root', async () => {
        const root = await createTempWorkspace('harness-sandbox');
        try {
            const sandbox = new LocalSandbox(root);
            const harness = createRuntime(
                { model: textModel('ok') as any, skipDefaultPlugins: true },
                { sandbox },
            );
            const session = await harness.session({ persist: false });
            expect(session.raw).toBeDefined();
            expect(sandbox.root).toBe(root);
        } finally {
            await removeTempWorkspace(root);
        }
    });

    test('persisted sessions are the single owner: same id returns the same instance', async () => {
        const root = await createTempWorkspace('harness-persist');
        try {
            const harness = createRuntime(
                { model: textModel('hi') as any, skipDefaultPlugins: true },
                { dbPath: join(root, 'vibes.db'), sessionsDir: join(root, 'sessions') },
            );

            const a = await harness.session('sess-1');
            const b = await harness.session('sess-1');
            // Cached: one agent instance per id (no duplicate caches).
            expect(a).toBe(b);
            expect(a.id).toBe('sess-1');
            expect(a.backend).toBeDefined();

            const sessions = await harness.listSessions();
            expect(sessions.some((s) => s.id === 'sess-1')).toBe(true);
        } finally {
            await removeTempWorkspace(root);
        }
    });

    test('flagship agent exposes ALL plugin tools (regression: tool-cache race)', async () => {
        const root = await createTempWorkspace('harness-tools');
        try {
            // No skipDefaultPlugins → the flagship adds its default plugins in
            // the subclass constructor AFTER super().preloadTools(). This used
            // to leave the tool cache stuck with zero plugin tools (only custom
            // tools survived), so the model never saw bash/generate_tasks/etc.
            const harness = createRuntime({ model: textModel('hi') as any, workspaceDir: root });
            const session = await harness.session({ persist: false });
            const tools = await (session.raw as any).getAllTools();
            const names = Object.keys(tools);

            expect(names.length).toBeGreaterThan(20);
            // Tools from several different plugins should all be present (the
            // race used to drop every plugin tool). File I/O is full-bash now,
            // so there is no readFile/writeFile — bash is the file interface.
            expect(names).toContain('bash');
            expect(names).toContain('generate_tasks');
            expect(names).toContain('create_artifact');
            expect(names).toContain('remember');
        } finally {
            await removeTempWorkspace(root);
        }
    });
});
