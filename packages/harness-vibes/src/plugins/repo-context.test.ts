import { describe, test, expect } from 'bun:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import RepoContextPlugin from './repo-context';

const tmpDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'repo-ctx-'));

describe('RepoContextPlugin', () => {
    test('injects CLAUDE.md content into the prompt', async () => {
        const dir = await tmpDir();
        await fs.writeFile(path.join(dir, 'CLAUDE.md'), 'Use tabs, not spaces.');
        const out = await new RepoContextPlugin(dir).modifySystemPrompt('BASE');
        expect(out).toContain('BASE');
        expect(out).toContain('Repository Context');
        expect(out).toContain('Use tabs, not spaces.');
    });

    test('no-op when no guidance files exist', async () => {
        const dir = await tmpDir();
        const out = await new RepoContextPlugin(dir).modifySystemPrompt('BASE');
        expect(out).toBe('BASE');
    });

    test('caps oversized files with a truncation marker', async () => {
        const dir = await tmpDir();
        await fs.writeFile(path.join(dir, 'AGENTS.md'), 'x'.repeat(20_000));
        const out = await new RepoContextPlugin(dir).modifySystemPrompt('BASE');
        expect(out).toContain('[truncated]');
        expect(out.length).toBeLessThan(20_000);
    });
});
