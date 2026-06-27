import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { join } from 'path';
import { writeFile, readFile, stat } from 'fs/promises';
import { createRuntime, SqliteBackend } from '../index';
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

function harnessAt(root: string) {
    return createRuntime(
        { model: textModel('ok') as any, workspaceDir: root },
        {
            dbPath: join(root, 'vibes.db'),
            sessionsDir: join(root, 'sessions'),
            projectsDir: join(root, 'projects'),
        },
    );
}

describe('Workspaces (projects that group sessions)', () => {
    test('a migration-backfilled Default workspace exists', async () => {
        const root = await createTempWorkspace('ws-default');
        try {
            const harness = harnessAt(root);
            // Touch the DB so the SqliteBackend runs its migrations.
            await harness.listSessions();
            const workspaces = await harness.listWorkspaces();
            expect(workspaces.some((w) => w.id === 'default')).toBe(true);
        } finally {
            await removeTempWorkspace(root);
        }
    });

    test('sessions in a workspace share the project dir; state stays per-session', async () => {
        const root = await createTempWorkspace('ws-shared');
        try {
            const harness = harnessAt(root);
            const ws = await harness.createWorkspace({ name: 'my-app' });

            const a = await harness.session({ id: 'sess-a', workspaceId: ws.id });
            const b = await harness.session({ id: 'sess-b', workspaceId: ws.id });

            // Both sessions are rooted at the SAME shared project dir.
            expect(a.workspaceDir).toBe(ws.rootDir);
            expect(b.workspaceDir).toBe(ws.rootDir);

            // A file written into the project dir is visible to every session.
            await writeFile(join(ws.rootDir, 'hello.txt'), 'shared');
            expect(await readFile(join(a.workspaceDir, 'hello.txt'), 'utf8')).toBe('shared');
            expect(await readFile(join(b.workspaceDir, 'hello.txt'), 'utf8')).toBe('shared');

            // Per-session plugin state is isolated under .vibes/sessions/{id}/.
            const stateA = harness.readState('sess-a').metadata?.stateDir as string;
            const stateB = harness.readState('sess-b').metadata?.stateDir as string;
            expect(stateA).toBe(join(ws.rootDir, '.vibes', 'sessions', 'sess-a'));
            expect(stateB).toBe(join(ws.rootDir, '.vibes', 'sessions', 'sess-b'));
            expect(stateA).not.toBe(stateB);

            // listSessions scoped to the workspace returns exactly these two.
            const scoped = await harness.listSessions(ws.id);
            const ids = scoped.map((s) => s.id).sort();
            expect(ids).toEqual(['sess-a', 'sess-b']);
        } finally {
            await removeTempWorkspace(root);
        }
    });

    test('a new session with no explicit workspace joins Default (shared project dir)', async () => {
        const root = await createTempWorkspace('ws-implicit');
        try {
            const harness = harnessAt(root);
            const s = await harness.session('implicit-1');
            // The Default workspace's project dir is reconciled to projectsDir.
            expect(s.workspaceDir).toBe(join(root, 'projects', 'default'));
        } finally {
            await removeTempWorkspace(root);
        }
    });

    test('a session whose metadata already pins workspaceDir keeps it (legacy)', async () => {
        const root = await createTempWorkspace('ws-legacy');
        try {
            const harness = harnessAt(root);
            // Simulate a pre-existing session created before workspaces existed:
            // its metadata already records an isolated per-session dir.
            const legacyDir = join(root, 'sessions', 'legacy-1');
            const backend = new SqliteBackend(join(root, 'vibes.db'), 'legacy-1');
            await backend.updateSession('legacy-1', { metadata: { workspaceDir: legacyDir } });
            backend.close();

            const s = await harness.session('legacy-1');
            expect(s.workspaceDir).toBe(legacyDir);
        } finally {
            await removeTempWorkspace(root);
        }
    });

    test('open-folder workspace points at an existing dir; .vibes stays app-managed', async () => {
        const root = await createTempWorkspace('ws-openfolder');
        const repo = await createTempWorkspace('ws-existing-repo');
        try {
            await writeFile(join(repo, 'README.md'), '# real repo');
            const harness = harnessAt(root);
            const ws = await harness.createWorkspace({ rootDir: repo });

            expect(ws.rootDir).toBe(repo);
            expect((ws.metadata as any)?.external).toBe(true);
            expect(ws.name).toBe(repo.split('/').pop()); // defaulted to basename

            const s = await harness.session({ id: 'in-repo', workspaceId: ws.id });
            // The agent works directly in the opened repo …
            expect(s.workspaceDir).toBe(repo);
            expect(await readFile(join(s.workspaceDir, 'README.md'), 'utf8')).toBe('# real repo');
            // … but per-session state is kept OUT of the repo (app-managed).
            const stateDir = harness.readState('in-repo').metadata?.stateDir as string;
            expect(stateDir.startsWith(join(root, 'projects', ws.id))).toBe(true);
            expect(stateDir.startsWith(repo)).toBe(false);
        } finally {
            await removeTempWorkspace(root);
            await removeTempWorkspace(repo);
        }
    });

    test('deleting an open-folder workspace NEVER deletes the opened folder', async () => {
        const root = await createTempWorkspace('ws-safe-delete');
        const repo = await createTempWorkspace('ws-precious-repo');
        try {
            await writeFile(join(repo, 'keep.txt'), 'do not delete');
            const harness = harnessAt(root);
            const ws = await harness.createWorkspace({ rootDir: repo });
            await harness.session({ id: 'tmp', workspaceId: ws.id });

            await harness.deleteWorkspace(ws.id);

            // The workspace record is gone …
            expect((await harness.listWorkspaces()).some((w) => w.id === ws.id)).toBe(false);
            // … but the user's folder + file are untouched.
            expect(await readFile(join(repo, 'keep.txt'), 'utf8')).toBe('do not delete');
        } finally {
            await removeTempWorkspace(root);
            await removeTempWorkspace(repo);
        }
    });

    test('deleting a workspace removes its sessions and project dir', async () => {
        const root = await createTempWorkspace('ws-delete');
        try {
            const harness = harnessAt(root);
            const ws = await harness.createWorkspace({ name: 'scratch' });
            await harness.session({ id: 'doomed', workspaceId: ws.id });

            await stat(ws.rootDir); // exists
            await harness.deleteWorkspace(ws.id);

            expect((await harness.listWorkspaces()).some((w) => w.id === ws.id)).toBe(false);
            expect((await harness.listSessions(ws.id)).length).toBe(0);
            await expect(stat(ws.rootDir)).rejects.toThrow();
        } finally {
            await removeTempWorkspace(root);
        }
    });
});
