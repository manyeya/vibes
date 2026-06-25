import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDefaultPlugins, createSubAgentPlugins } from '../src/core/agent/vibe-agent';
import type { Plugin } from '../src/core/types';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'vibes-art-')); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const artifactPlugin = (plugins: Plugin[]) =>
  plugins.find((p) => p.name === 'ArtifactPlugin') as (Plugin & { tools: any }) | undefined;

// A project session has stateDir (per-session) distinct from workspaceDir (the
// shared project sandbox). Artifacts must land in the per-session stateDir, not
// the shared workspace — otherwise sessions in a project pool/collide artifacts.
describe('Artifacts are stored per-session (stateDir, not the shared workspace)', () => {
  for (const [label, factory] of [
    ['main agent', createDefaultPlugins],
    ['sub-agent', createSubAgentPlugins],
  ] as const) {
    test(`${label} writes artifacts under stateDir, not workspaceDir`, async () => {
      const workspaceDir = tmp(); // shared project sandbox root
      const stateDir = tmp();     // per-session state dir (distinct)
      const art = artifactPlugin(factory({ model: {} as any, workspaceDir, stateDir }));
      expect(art).toBeTruthy();

      const res: any = await art!.tools.create_artifact.execute({
        title: 'My Report', kind: 'markdown', content: '# hi',
      });
      expect(res.success).toBe(true);

      // res.savedTo is sandbox-relative (e.g. artifacts/my-report-ab12.md).
      expect(existsSync(join(stateDir, res.savedTo))).toBe(true);
      expect(existsSync(join(workspaceDir, res.savedTo))).toBe(false);
    });
  }

  test('non-workspace session keeps the legacy per-session path (stateDir === workspaceDir)', async () => {
    const dir = tmp(); // stateDir defaults to workspaceDir
    const art = artifactPlugin(createDefaultPlugins({ model: {} as any, workspaceDir: dir }));
    const res: any = await art!.tools.create_artifact.execute({ title: 'Doc', kind: 'markdown', content: 'x' });
    expect(existsSync(join(dir, res.savedTo))).toBe(true);
  });
});
