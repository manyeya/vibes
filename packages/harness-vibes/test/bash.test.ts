import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import BashPlugin from '../src/plugins/bash';
import { LocalSandbox } from '../src/sandbox/local-sandbox';

describe('BashPlugin: real host shell', () => {
  test('runs a command and captures stdout + exit code', async () => {
    const plugin = new BashPlugin({ sandbox: new LocalSandbox(process.cwd()) });
    const bash = plugin.tools.bash as { execute: (a: unknown, b: unknown) => Promise<any> };

    const out = await bash.execute({ command: 'echo hello' }, {});
    expect(out.exitCode).toBe(0);
    expect(out.stdout.trim()).toBe('hello');
  });

  test('resolves an absolute workspace path with no ENOENT (real shell, no rewriting)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bash-abs-'));
    try {
      await writeFile(join(root, 'AGENTS.md'), 'hello agents');
      const plugin = new BashPlugin({ sandbox: new LocalSandbox(root) });
      const bash = plugin.tools.bash as { execute: (a: unknown, b: unknown) => Promise<any> };

      // The model naturally uses the absolute workspace path it was told about.
      const out = await bash.execute({ command: `cat ${root}/AGENTS.md` }, {});
      expect(out.exitCode).toBe(0);
      expect(out.stdout).toContain('hello agents');
      expect(JSON.stringify(out).toLowerCase()).not.toContain('no such file');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
