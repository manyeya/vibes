import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { LocalSandbox } from '../src/sandbox/local-sandbox';
import { containPath } from '../src/core/sandbox';
import { createTempWorkspace, removeTempWorkspace } from './helpers';

describe('LocalSandbox', () => {
    test('writes, reads, checks existence, and reports bytes written', async () => {
        const root = await createTempWorkspace('sandbox-io');
        try {
            const sandbox = new LocalSandbox(root);

            expect(await sandbox.exists('notes/todo.txt')).toBe(false);
            const bytes = await sandbox.writeFile('notes/todo.txt', 'hello world');
            expect(bytes).toBe('hello world'.length);
            expect(await sandbox.exists('notes/todo.txt')).toBe(true);
            expect(await sandbox.readFile('notes/todo.txt')).toBe('hello world');
        } finally {
            await removeTempWorkspace(root);
        }
    });

    test('lists files non-recursively and recursively', async () => {
        const root = await createTempWorkspace('sandbox-list');
        try {
            const sandbox = new LocalSandbox(root);
            await sandbox.writeFile('a.txt', 'a');
            await sandbox.writeFile('nested/b.txt', 'b');

            const top = await sandbox.list('.', { recursive: false });
            expect(top).toContain('a.txt');
            expect(top).not.toContain('nested/b.txt');

            const all = await sandbox.list('.', { recursive: true });
            expect(all).toContain('a.txt');
            expect(all).toContain(join('nested', 'b.txt'));
        } finally {
            await removeTempWorkspace(root);
        }
    });

    test('exec captures stdout and a non-zero exit code without throwing', async () => {
        const root = await createTempWorkspace('sandbox-exec');
        try {
            const sandbox = new LocalSandbox(root);

            const ok = await sandbox.exec('echo hello');
            expect(ok.exitCode).toBe(0);
            expect(ok.stdout.trim()).toBe('hello');

            const fail = await sandbox.exec('exit 3');
            expect(fail.exitCode).toBe(3);
        } finally {
            await removeTempWorkspace(root);
        }
    });

    test('contains paths within the root and rejects traversal', async () => {
        const root = await createTempWorkspace('sandbox-contain');
        try {
            const sandbox = new LocalSandbox(root);

            // In-bounds resolves fine.
            expect(sandbox.resolve('sub/file.txt')).toBe(join(sandbox.root, 'sub/file.txt'));

            // Traversal and absolute escapes throw.
            expect(() => sandbox.resolve('../escape.txt')).toThrow(/escapes the sandbox root/);
            expect(() => sandbox.resolve('/etc/passwd')).toThrow(/escapes the sandbox root/);
            await expect(sandbox.readFile('../../secret')).rejects.toThrow(/escapes the sandbox root/);
        } finally {
            await removeTempWorkspace(root);
        }
    });

    test('containPath helper allows the root itself and nested paths', () => {
        const root = '/tmp/work';
        expect(containPath(root, '.')).toBe('/tmp/work');
        expect(containPath(root, 'a/b')).toBe('/tmp/work/a/b');
        expect(() => containPath(root, '../other')).toThrow();
    });
});
