import { describe, expect, test } from 'bun:test';
import { access, readFile } from 'fs/promises';
import { MockLanguageModelV3 } from 'ai/test';
import { join } from 'path';
import { createDefaultPlugins } from '../index';
import { createPluginStreamContext } from '../src/core/types';
import BashPlugin from '../src/plugins/bash';
import FilesystemPlugin from '../src/plugins/filesystem';
import { PlanningPlugin } from '../src/plugins/planning';
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
      await (memory.tools.save_reflection as any).execute({
        lesson: 'Keep auth decisions recorded outside ephemeral session state.',
      });

      await access(join(sessionDir, 'tasks.json'));
      await access(join(sessionDir, 'scratchpad.md'));
      await access(join(workspaceRoot, 'reflections.md'));

      const tasks = JSON.parse(await readFile(join(sessionDir, 'tasks.json'), 'utf8'));
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Inspect auth flow');

      const scratchpad = await readFile(join(sessionDir, 'scratchpad.md'), 'utf8');
      expect(scratchpad).toContain('stabilize auth session handling');

      const reflections = await readFile(join(workspaceRoot, 'reflections.md'), 'utf8');
      expect(reflections).toContain('Keep auth decisions recorded');
    } finally {
      await removeTempWorkspace(workspaceRoot);
    }
  });
});
