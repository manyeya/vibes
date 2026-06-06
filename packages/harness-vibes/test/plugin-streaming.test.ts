import { describe, expect, test } from 'bun:test';
import { access, readFile } from 'fs/promises';
import { MockLanguageModelV3 } from 'ai/test';
import { join } from 'path';
import { createDefaultPlugins } from '../index';
import { createPluginStreamContext } from '../src/core/types';
import BashPlugin from '../src/plugins/bash';
import FilesystemPlugin from '../src/plugins/filesystem';
import { PlanningPlugin } from '../src/plugins/planning';
import MemoryPlugin from '../src/plugins/memory';
import {
  createCapturingWriter,
  createTempWorkspace,
  removeTempWorkspace,
} from './helpers';

function attachStream(plugin: { onStreamContextReady?: (context: ReturnType<typeof createPluginStreamContext>) => void }, parts: any[], options?: Parameters<typeof createPluginStreamContext>[1]) {
  plugin.onStreamContextReady?.(createPluginStreamContext(createCapturingWriter(parts), options));
}

describe('Plugin streaming', () => {
  test('FilesystemPlugin emits detailed milestones for writeFile and readFile', async () => {
    const workspaceDir = await createTempWorkspace('filesystem-stream');
    const parts: any[] = [];

    try {
      const plugin = new FilesystemPlugin({
        baseDir: workspaceDir,
        trackedFilesPath: join(workspaceDir, 'tracked-files.json'),
      });

      await plugin.waitReady();
      attachStream(plugin, parts);

      await (plugin.tools.writeFile as any).execute({
        path: 'notes/todo.txt',
        content: 'hello world',
      });
      await (plugin.tools.readFile as any).execute({
        path: 'notes/todo.txt',
      });

      const statuses = parts
        .filter(part => part.type === 'data-status')
        .map(part => part.data.phase);

      expect(statuses).toEqual([
        'mkdir',
        'write',
        'track',
        'complete',
        'resolve',
        'read',
        'complete',
      ]);
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('BashPlugin emits heartbeat updates for delayed commands', async () => {
    const workspaceDir = await createTempWorkspace('bash-stream');
    const parts: any[] = [];

    try {
      const plugin = new BashPlugin(workspaceDir);
      attachStream(plugin, parts, { heartbeatStartMs: 5, heartbeatIntervalMs: 5 });

      await (plugin.tools.bash as any).execute({
        command: 'sleep 0.03',
      });

      const heartbeat = parts.find(
        part => part.type === 'data-status' && String(part.id).startsWith('heartbeat:'),
      );

      expect(heartbeat).toBeDefined();
      expect(heartbeat.transient).toBe(true);
      expect(heartbeat.data.phase).toBe('heartbeat');
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('PlanningPlugin emits ordered milestones during plan generation', async () => {
    const workspaceDir = await createTempWorkspace('planning-stream');
    const parts: any[] = [];

    try {
      const model = new MockLanguageModelV3({
        doGenerate: async () => ({
          finishReason: { type: 'stop', unified: 'stop' },
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                title: 'Auth Refactor',
                problem: 'Authentication is fragmented.',
                solution: 'Unify auth boundaries and flows.',
                requirements: ['Document the flow'],
                phases: [{ name: 'Discover', goal: 'Map the current auth flow', steps: ['Inspect auth modules'] }],
                milestones: ['Flow documented'],
                risks: ['Migration risk'],
              }),
            },
          ],
          usage: {
            inputTokens: { total: 10 },
            outputTokens: { total: 20 },
          },
          warnings: [],
          providerMetadata: undefined,
        } as any),
      });

      const plugin = new PlanningPlugin(model as any, {
        planPath: join(workspaceDir, 'plan.md'),
      });

      await plugin.waitReady();
      attachStream(plugin, parts);

      const result = await (plugin.tools.create_plan as any).execute({
        request: 'Refactor the auth system',
      });

      expect(result.success).toBe(true);
      expect(
        parts
          .filter(part => part.type === 'data-status' && part.data.plugin === 'PlanningPlugin')
          .map(part => part.data.phase),
      ).toEqual(['prepare', 'model', 'parse', 'persist', 'complete']);
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('default plugin bundle keeps session state local and long-term memory shared', async () => {
    const workspaceRoot = await createTempWorkspace('default-plugin-paths');
    const sessionDir = join(workspaceRoot, 'sessions', 'session-a');
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        finishReason: { type: 'stop', unified: 'stop' },
        content: [{ type: 'text', text: '{}' }],
        usage: {
          inputTokens: { total: 1 },
          outputTokens: { total: 1 },
        },
        warnings: [],
        providerMetadata: undefined,
      } as any),
    });

    try {
      const plugins = createDefaultPlugins({
        model: model as any,
        workspaceDir: sessionDir,
        sessionId: 'session-a',
      });

      for (const plugin of plugins) {
        await plugin.waitReady?.();
      }

      const byName = (name: string) => {
        const plugin = plugins.find(candidate => candidate.name === name);
        expect(plugin).toBeDefined();
        return plugin as any;
      };

      const planning = byName('PlanningPlugin');
      const memory = byName('MemoryPlugin');

      await (planning.tools.create_tasks as any).execute({
        tasks: [
          {
            title: 'Inspect auth flow',
            description: 'Review the current authentication flow.',
          },
        ],
      });
      await (memory.tools.update_scratchpad as any).execute({
        content: 'Current goal: stabilize auth session handling.',
      });
      await (memory.tools.remember as any).execute({
        title: 'Auth session decision',
        content: 'Keep auth decisions recorded outside ephemeral session state.',
        tags: ['auth'],
      });

      await access(join(sessionDir, 'tasks.json'));
      await access(join(sessionDir, 'scratchpad.md'));
      await access(join(workspaceRoot, 'memories.json'));

      const tasks = JSON.parse(await readFile(join(sessionDir, 'tasks.json'), 'utf8'));
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Inspect auth flow');

      const scratchpad = await readFile(join(sessionDir, 'scratchpad.md'), 'utf8');
      expect(scratchpad).toContain('stabilize auth session handling');

      // Long-term notes are shared (workspace root), not session-local.
      const memories = JSON.parse(await readFile(join(workspaceRoot, 'memories.json'), 'utf8'));
      expect(memories).toHaveLength(1);
      expect(memories[0].content).toContain('Keep auth decisions recorded');
    } finally {
      await removeTempWorkspace(workspaceRoot);
    }
  });

  test('MemoryPlugin: remember/recall/forget round-trip + loads into the system prompt', async () => {
    const dir = await createTempWorkspace('memory-plugin');
    try {
      const memory = new MemoryPlugin({
        scratchpadPath: join(dir, 'scratchpad.md'),
        notesPath: join(dir, 'memories.json'),
      });
      await memory.waitReady();

      await (memory.tools.update_scratchpad as any).execute({ content: 'Working on the parser.' });
      const saved = await (memory.tools.remember as any).execute({
        title: 'Parser entry point',
        content: 'The parser starts in src/parse/index.ts at parseProgram().',
        tags: ['parser'],
      });
      expect(saved.success).toBe(true);
      await (memory.tools.remember as any).execute({
        title: 'DB choice',
        content: 'We use SQLite via bun:sqlite.',
        tags: ['db'],
      });

      // keyword search returns the right note in full
      const hit = await (memory.tools.recall as any).execute({ query: 'parser entry' });
      expect(hit.count).toBeGreaterThanOrEqual(1);
      expect(hit.results[0].content).toContain('parseProgram');

      // the async system prompt loads from disk: full scratchpad + a compact
      // index of note titles, but NOT the full note bodies (no bloat).
      const prompt = await memory.modifySystemPrompt('BASE');
      expect(prompt).toContain('Working on the parser.');
      expect(prompt).toContain('Parser entry point');
      expect(prompt).toContain('DB choice');
      expect(prompt).not.toContain('parseProgram');

      const list = await (memory.tools.list_memories as any).execute({});
      expect(list.count).toBe(2);
      await (memory.tools.forget as any).execute({ id: saved.id });
      const after = await (memory.tools.list_memories as any).execute({});
      expect(after.count).toBe(1);
    } finally {
      await removeTempWorkspace(dir);
    }
  });
});
