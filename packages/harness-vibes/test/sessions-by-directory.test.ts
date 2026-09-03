import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { createRuntime } from '../index';
import { escapeDirKey } from '../src/core/session/session-manager';
import { createTempWorkspace, removeTempWorkspace } from './helpers';

/**
 * A session is a conversation rooted at a directory — there is no workspace
 * object. These replace the old workspaces tests.
 */

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

const harnessAt = (root: string) =>
    createRuntime(
        { model: textModel('ok') as any, workspaceDir: root },
        {
            dbPath: join(root, 'vibes.db'),
            sessionsDir: join(root, 'sessions'),
            projectsDir: join(root, 'projects'),
        },
    );

describe('escapeDirKey', () => {
    test('flattens a path into a filesystem-safe key', () => {
        expect(escapeDirKey('/Users/me/Code/proj')).toBe('-Users-me-Code-proj');
    });

    test('distinct paths never collide, even when very long', () => {
        const a = escapeDirKey('/' + 'a'.repeat(300));
        const b = escapeDirKey('/' + 'a'.repeat(299) + 'b');
        expect(a).not.toBe(b);
        expect(a.length).toBeLessThanOrEqual(213); // 200 + '-' + 12-char hash
    });
});

describe('sessions are rooted at a directory', () => {
    test('a session works in the cwd it was created with', async () => {
        const root = await createTempWorkspace('cwd-root');
        try {
            const projA = join(root, 'projA');
            await mkdir(projA, { recursive: true });
            const rt = harnessAt(root);

            const id = await rt.createSession({ title: 'a', cwd: projA });
            const session = await rt.session(id);
            expect(session.workspaceDir).toBe(projA);
        } finally {
            await removeTempWorkspace(root);
        }
    });

    test('listSessions(cwd) returns only that directory\'s sessions', async () => {
        const root = await createTempWorkspace('cwd-filter');
        try {
            const projA = join(root, 'projA');
            const projB = join(root, 'projB');
            await mkdir(projA, { recursive: true });
            await mkdir(projB, { recursive: true });
            const rt = harnessAt(root);

            const a = await rt.createSession({ title: 'in A', cwd: projA });
            const b = await rt.createSession({ title: 'in B', cwd: projB });

            const inA = await rt.listSessions(projA);
            expect(inA.map((s) => s.id)).toEqual([a]);

            const inB = await rt.listSessions(projB);
            expect(inB.map((s) => s.id)).toEqual([b]);

            // No filter → everything.
            expect((await rt.listSessions()).length).toBe(2);
        } finally {
            await removeTempWorkspace(root);
        }
    });

    test('per-session state stays out of the project directory', async () => {
        const root = await createTempWorkspace('state-outside');
        try {
            const proj = join(root, 'myrepo');
            await mkdir(proj, { recursive: true });
            await writeFile(join(proj, 'file.txt'), 'user content');
            const rt = harnessAt(root);

            const id = await rt.createSession({ title: 's', cwd: proj });
            await rt.session(id);

            const info = await rt.getSessionInfo(id);
            const stateDir = String((info?.metadata as any)?.stateDir ?? '');
            // The agent's own state must never land inside the user's repo.
            expect(stateDir.startsWith(proj)).toBe(false);
            expect(stateDir).toContain(escapeDirKey(proj));
        } finally {
            await removeTempWorkspace(root);
        }
    });

    test('reloading a session keeps its original directory', async () => {
        const root = await createTempWorkspace('cwd-reload');
        try {
            const proj = join(root, 'projA');
            await mkdir(proj, { recursive: true });
            const rt = harnessAt(root);

            const id = await rt.createSession({ title: 'a', cwd: proj });
            await rt.session(id);

            // Reload knowing only the id — must not fall back to process.cwd().
            const rt2 = harnessAt(root);
            expect((await rt2.session(id)).workspaceDir).toBe(proj);
        } finally {
            await removeTempWorkspace(root);
        }
    });
});
