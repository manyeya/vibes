import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import BashPlugin from '../src/plugins/bash';
import { LocalSandbox } from '../src/sandbox/local-sandbox';

// Expose the protected path-translation for a unit test.
class TestBash extends BashPlugin {
  translate(cmd: string) {
    return (this as unknown as { toWorkspacePath(c: string): string }).toWorkspacePath(cmd);
  }
}

describe('BashPlugin: absolute workspace paths', () => {
  test('rewrites host paths under the root to the virtual root', () => {
    const plugin = new TestBash({ sandbox: new LocalSandbox('/Users/me/repo') });
    // nested path → relative to virtual root
    expect(plugin.translate('cd "/" && ls /Users/me/repo/src')).toBe('cd "/" && ls /src');
    expect(plugin.translate('cat /Users/me/repo/AGENTS.md')).toBe('cat /AGENTS.md');
    // bare root → "/"
    expect(plugin.translate('ls /Users/me/repo')).toBe('ls /');
    // a sibling dir that merely shares a prefix is NOT rewritten
    expect(plugin.translate('ls /Users/me/repo-backup/x')).toBe('ls /Users/me/repo-backup/x');
    // already-relative commands are untouched
    expect(plugin.translate('cat README.md')).toBe('cat README.md');
  });

  test('regression: a command using the absolute workspace path resolves (no ENOENT)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bash-abs-'));
    try {
      await writeFile(join(root, 'AGENTS.md'), 'hello agents');
      const plugin = new BashPlugin({ sandbox: new LocalSandbox(root) });
      await plugin.waitReady();
      const bash = plugin.tools.bash as { execute: (a: unknown, b: unknown) => Promise<unknown> };

      // The model naturally uses the absolute workspace path it was told about.
      const out = await bash.execute({ command: `cat ${root}/AGENTS.md` }, {});
      const text = JSON.stringify(out);
      expect(text).toContain('hello agents');
      expect(text.toLowerCase()).not.toContain('no such file');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
