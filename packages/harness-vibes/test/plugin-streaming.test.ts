import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { join } from 'path';
import { createPluginStreamContext } from '../src/core/types';
import BashPlugin from '../src/plugins/bash';
import FilesystemPlugin from '../src/plugins/filesystem';
import { PlanningPlugin } from '../src/plugins/planning';
import { ProceduralMemoryPlugin } from '../src/plugins/procedural-memory';
import { SemanticMemoryPlugin } from '../src/plugins/semantic-memory';
import { SwarmPlugin } from '../src/plugins/swarm';
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

  test('Semantic and procedural memory plugins emit memory updates on mutation tools', async () => {
    const workspaceDir = await createTempWorkspace('memory-stream');
    const semanticParts: any[] = [];
    const proceduralParts: any[] = [];

    try {
      const semantic = new SemanticMemoryPlugin(undefined, {
        factsPath: join(workspaceDir, 'facts.json'),
      });
      await semantic.waitReady();
      attachStream(semantic, semanticParts);
      await (semantic.tools.remember_fact as any).execute({
        fact: 'Auth tokens expire after 15 minutes',
        importance: 0.8,
        category: 'code',
      });

      const procedural = new ProceduralMemoryPlugin(undefined, {
        patternsPath: join(workspaceDir, 'patterns.json'),
      });
      await procedural.waitReady();
      attachStream(procedural, proceduralParts);
      await (procedural.tools.save_pattern as any).execute({
        name: 'Auth Regression Checklist',
        description: 'Validate auth before shipping',
        whenToUse: 'Before deploying auth changes',
        steps: ['Run auth tests', 'Verify token refresh'],
        category: 'testing',
      });

      expect(
        semanticParts.find(
          part => part.type === 'data-memory_update' && part.data.type === 'fact' && part.data.action === 'saved',
        ),
      ).toBeDefined();

      expect(
        proceduralParts.find(
          part => part.type === 'data-memory_update' && part.data.type === 'pattern' && part.data.action === 'saved',
        ),
      ).toBeDefined();
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('SwarmPlugin emits swarm signal parts for signaling flows', async () => {
    const parts: any[] = [];
    const plugin = new SwarmPlugin('planner');

    attachStream(plugin, parts);

    await (plugin.tools.signal as any).execute({
      to: 'coder',
      message: 'Inspect auth failure logs',
      type: 'request',
    });

    const signalPart = parts.find(part => part.type === 'data-swarm_signal');
    expect(signalPart).toBeDefined();
    expect(signalPart.data.from).toBe('planner');
    expect(signalPart.data.to).toBe('coder');
    expect(signalPart.data.signal).toBe('Inspect auth failure logs');
  });
});
