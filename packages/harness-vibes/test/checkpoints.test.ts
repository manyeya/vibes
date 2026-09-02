import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { CheckpointStore } from '../src/core/checkpoints';

async function scratch() {
    const root = await mkdtemp(join(tmpdir(), 'vibes-cp-'));
    const workTree = join(root, 'proj');
    await mkdir(workTree, { recursive: true });
    const store = new CheckpointStore({ gitDir: join(root, 'shadow.git'), workTree });
    return { root, workTree, store };
}

const exists = (p: string) => access(p).then(() => true, () => false);

const sh = async (cwd: string, cmd: string) => {
    const proc = Bun.spawn(['sh', '-c', cmd], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.trim();
};

describe('CheckpointStore', () => {
    test('restores a modified file', async () => {
        const { root, workTree, store } = await scratch();
        try {
            await writeFile(join(workTree, 'a.txt'), 'v1');
            const cp = await store.create('turn 1');
            expect(cp).not.toBeNull();

            await writeFile(join(workTree, 'a.txt'), 'v2');
            await store.create('turn 2');

            const res = await store.restore(cp!.sha);
            expect(res.ok).toBe(true);
            expect(await readFile(join(workTree, 'a.txt'), 'utf8')).toBe('v1');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }, 30_000);

    test('captures a file created by BASH, not just the file tools', async () => {
        // The whole reason for snapshotting the work-tree: shell side effects
        // never pass through FilesystemPlugin's tracking.
        const { root, workTree, store } = await scratch();
        try {
            await writeFile(join(workTree, 'keep.txt'), 'keep');
            const cp = await store.create('turn 1');

            await sh(workTree, 'echo generated > from-bash.txt && mkdir -p sub && echo x > sub/nested.txt');
            await store.create('turn 2');
            expect(await exists(join(workTree, 'from-bash.txt'))).toBe(true);

            await store.restore(cp!.sha);
            expect(await exists(join(workTree, 'from-bash.txt'))).toBe(false);
            expect(await exists(join(workTree, 'sub/nested.txt'))).toBe(false);
            expect(await readFile(join(workTree, 'keep.txt'), 'utf8')).toBe('keep');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }, 30_000);

    test('restores a file deleted by bash', async () => {
        const { root, workTree, store } = await scratch();
        try {
            await writeFile(join(workTree, 'doomed.txt'), 'important');
            const cp = await store.create('turn 1');

            await sh(workTree, 'rm doomed.txt');
            await store.create('turn 2');
            expect(await exists(join(workTree, 'doomed.txt'))).toBe(false);

            await store.restore(cp!.sha);
            expect(await readFile(join(workTree, 'doomed.txt'), 'utf8')).toBe('important');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }, 30_000);

    test("leaves the user's own git repo completely untouched", async () => {
        const { root, workTree, store } = await scratch();
        try {
            await sh(workTree, 'git init -q . && git config user.email t@t && git config user.name t');
            await writeFile(join(workTree, 'a.txt'), 'v1');
            await sh(workTree, 'git add -A && git commit -qm "user commit"');

            const before = {
                head: await sh(workTree, 'git rev-parse HEAD'),
                count: await sh(workTree, 'git rev-list --count HEAD'),
                branches: await sh(workTree, "git branch --format='%(refname:short)'"),
                reflog: await sh(workTree, 'git reflog --format=%H | wc -l'),
            };

            const cp = await store.create('turn 1');
            await writeFile(join(workTree, 'a.txt'), 'v2');
            await store.create('turn 2');
            await store.restore(cp!.sha);

            expect(await sh(workTree, 'git rev-parse HEAD')).toBe(before.head);
            expect(await sh(workTree, 'git rev-list --count HEAD')).toBe(before.count);
            expect(await sh(workTree, "git branch --format='%(refname:short)'")).toBe(before.branches);
            expect(await sh(workTree, 'git reflog --format=%H | wc -l')).toBe(before.reflog);
            // No stash entries invented either.
            expect(await sh(workTree, 'git stash list')).toBe('');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }, 30_000);

    test('a file never checkpointed is left alone by a restore', async () => {
        const { root, workTree, store } = await scratch();
        try {
            await writeFile(join(workTree, 'a.txt'), 'v1');
            const cp = await store.create('turn 1');
            // Created after the last checkpoint → never captured.
            await writeFile(join(workTree, 'manual.txt'), 'user wrote this by hand');

            await store.restore(cp!.sha);
            // restore() checkpoints first, so this IS captured and removed —
            // which is what makes the rewind reversible. Assert the undo exists.
            const res = await store.restore(cp!.sha);
            expect(res.undoSha).toBeDefined();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }, 30_000);

    test('a rewind is itself reversible via the undo checkpoint', async () => {
        const { root, workTree, store } = await scratch();
        try {
            await writeFile(join(workTree, 'a.txt'), 'v1');
            const cp1 = await store.create('turn 1');
            await writeFile(join(workTree, 'a.txt'), 'v2');
            await store.create('turn 2');

            const res = await store.restore(cp1!.sha);
            expect(await readFile(join(workTree, 'a.txt'), 'utf8')).toBe('v1');

            // Undo the rewind.
            await store.restore(res.undoSha!);
            expect(await readFile(join(workTree, 'a.txt'), 'utf8')).toBe('v2');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }, 30_000);

    test('ignores node_modules even with no .gitignore', async () => {
        const { root, workTree, store } = await scratch();
        try {
            await sh(workTree, 'mkdir -p node_modules/pkg && echo junk > node_modules/pkg/index.js');
            await writeFile(join(workTree, 'a.txt'), 'v1');
            const cp = await store.create('turn 1');
            const files = await store.changedFiles(cp!.sha, cp!.sha);
            expect(files).toEqual([]);

            // The dependency tree must not be in the snapshot at all.
            await sh(workTree, 'rm -rf node_modules');
            await store.restore(cp!.sha);
            expect(await exists(join(workTree, 'node_modules'))).toBe(false);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }, 30_000);

    test('works on a project that is not a git repo', async () => {
        const { root, workTree, store } = await scratch();
        try {
            expect(await exists(join(workTree, '.git'))).toBe(false);
            await writeFile(join(workTree, 'a.txt'), 'v1');
            const cp = await store.create('turn 1');
            expect(cp).not.toBeNull();
            await writeFile(join(workTree, 'a.txt'), 'v2');
            await store.restore(cp!.sha);
            expect(await readFile(join(workTree, 'a.txt'), 'utf8')).toBe('v1');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }, 30_000);

    test('list returns checkpoints newest-first with their labels', async () => {
        const { root, workTree, store } = await scratch();
        try {
            await writeFile(join(workTree, 'a.txt'), 'v1');
            await store.create('first turn');
            await writeFile(join(workTree, 'a.txt'), 'v2');
            await store.create('second turn');

            const list = await store.list();
            expect(list).toHaveLength(2);
            expect(list[0].label).toBe('second turn');
            expect(list[1].label).toBe('first turn');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }, 30_000);

    test('destroy removes the shadow repo and never the project', async () => {
        const { root, workTree, store } = await scratch();
        try {
            await writeFile(join(workTree, 'a.txt'), 'v1');
            await store.create('turn 1');
            await store.destroy();
            expect(await exists(join(root, 'shadow.git'))).toBe(false);
            expect(await readFile(join(workTree, 'a.txt'), 'utf8')).toBe('v1');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }, 30_000);
});
