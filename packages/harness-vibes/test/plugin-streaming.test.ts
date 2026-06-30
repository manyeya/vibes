import { describe, expect, test } from 'bun:test';
import { access, readFile } from 'fs/promises';
import { MockLanguageModelV3 } from 'ai/test';
import { join } from 'path';
import { createDefaultPlugins } from '../index';
import { createPluginStreamContext } from '../src/core/types';
import FilesystemPlugin from '../src/plugins/filesystem';
import { PlanningPlugin } from '../src/plugins/planning';
import TasksPlugin from '../src/plugins/tasks';
import MemoryPlugin from '../src/plugins/memory';
import SummarizationPlugin from '../src/plugins/summarization';
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

  test('TasksPlugin generated tasks use real dependency IDs and unblock sequentially', async () => {
    const workspaceDir = await createTempWorkspace('tasks-sequential');
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now++;

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        finishReason: { type: 'stop', unified: 'stop' },
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              tasks: [
                { title: 'Create package manifest', description: 'Create package.json', fileReferences: ['package.json'] },
                { title: 'Create server entry', description: 'Create src/index.ts', fileReferences: ['src/index.ts'] },
                { title: 'Run verification', description: 'Run the test/build command', fileReferences: [] },
              ],
            }),
          },
        ],
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
        providerMetadata: undefined,
      } as any),
    });

    try {
      const plugin = new TasksPlugin(model as any, { tasksPath: join(workspaceDir, 'tasks.json') });
      await plugin.waitReady();

      await (plugin.tools.generate_tasks as any).execute({ request: 'Scaffold a Hono API' });
      let tasks = JSON.parse(await readFile(join(workspaceDir, 'tasks.json'), 'utf8'));
      expect(tasks[1].blockedBy).toEqual([tasks[0].id]);
      expect(tasks[2].blockedBy).toEqual([tasks[1].id]);

      await (plugin.tools.update_task as any).execute({ id: tasks[0].id, status: 'completed' });
      tasks = JSON.parse(await readFile(join(workspaceDir, 'tasks.json'), 'utf8'));
      expect(tasks[1].status).toBe('pending');
      expect(tasks[2].status).toBe('blocked');
    } finally {
      Date.now = originalNow;
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('PlanningPlugin recites active tasks into the per-step system prompt', async () => {
    const workspaceDir = await createTempWorkspace('planning-recitation');

    try {
      const plugin = new PlanningPlugin(undefined, {
        planPath: join(workspaceDir, 'plan.md'),
        tasksPath: join(workspaceDir, 'tasks.json'),
      });
      await plugin.waitReady();

      await (plugin.tools.create_tasks as any).execute({
        tasks: [
          {
            title: 'Patch task lifecycle',
            description: 'Update the task plugin so models can follow and finish tasks.',
            fileReferences: ['packages/harness-vibes/src/plugins/tasks.ts'],
          },
        ],
      });

      const result = await plugin.prepareStep({
        steps: [],
        stepNumber: 0,
        model: {} as any,
        messages: [],
        system: 'BASE SYSTEM',
      });

      expect(result?.system).toContain('BASE SYSTEM');
      expect(result?.system).toContain('Current Plan');
      expect(result?.system).toContain('Patch task lifecycle');
      expect(result?.system).toContain('update_task');
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('SummarizationPlugin: token-based — compresses past the threshold', async () => {
    const parts: any[] = [];
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        finishReason: { type: 'stop', unified: 'stop' },
        content: [{ type: 'text', text: '• earlier work summarised' }],
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
        providerMetadata: undefined,
      } as any),
    });
    // window 1000 tok, ratio 0.7 → compress at 700 tok (~2800 chars).
    const plugin = new SummarizationPlugin(model as any, { contextWindow: 1000, compressionRatio: 0.7 });
    plugin.onStreamContextReady(createPluginStreamContext(createCapturingWriter(parts)));

    // Small conversation → under threshold → no compression. The live gauge is
    // now emitted by AgentHarness from real provider tokens, not this plugin.
    await (plugin.prepareStep as any)({ steps: [], stepNumber: 0, model, messages: [{ role: 'user', content: 'hi' }] });
    expect(parts.some((p) => p.type === 'data-summarization')).toBe(false);
    expect(parts.some((p) => p.type === 'data-context_usage')).toBe(false);

    // Big conversation (~2000 tok) → over threshold → summarize oldest, keep recent.
    const big = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: 'x'.repeat(400),
    }));
    const result: any = await (plugin.prepareStep as any)({ steps: [], stepNumber: 1, model, messages: big });
    expect(parts.some((p) => p.type === 'data-summarization' && p.data.stage === 'complete')).toBe(true);
    // result prepends a summary system message, keeps a verbatim tail
    expect(result?.messages?.[0]?.role).toBe('system');
    expect(String(result.messages[0].content)).toContain('summarised');
    expect(result.messages.length).toBeLessThan(big.length + 1);
  });

  test('SummarizationPlugin: counts tool-call/result payloads toward the token estimate', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        finishReason: { type: 'stop', unified: 'stop' },
        content: [{ type: 'text', text: '• summarised' }],
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
        providerMetadata: undefined,
      } as any),
    });
    // window 1000 tok, ratio 0.7 → compress at 700 tok (~2800 chars).
    const plugin = new SummarizationPlugin(model as any, { contextWindow: 1000, compressionRatio: 0.7 });

    // A heavy tool result (a big file dump) is the bulk of a real agent's
    // context. The old estimate ignored the payload and never tripped
    // compression; now it must.
    const heavyToolOutput = 'y'.repeat(4000);
    const messages = [
      { role: 'user', content: 'read the file' },
      { role: 'assistant', content: [{ type: 'tool-call', toolName: 'bash', input: { command: 'cat big.txt' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolName: 'bash', output: { type: 'text', value: heavyToolOutput } }] },
    ];
    const result: any = await (plugin.prepareStep as any)({ steps: [], stepNumber: 0, model, messages });
    // ~4000+ chars / 4 ≈ 1000+ tok > 700 → compression must trigger.
    expect(result?.messages?.[0]?.role).toBe('system');
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
