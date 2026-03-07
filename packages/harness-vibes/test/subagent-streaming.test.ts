import { describe, expect, test } from 'bun:test';
import SubAgentPlugin from '../src/plugins/subagent';
import type { Plugin } from '../src/core/types';
import { completionSteps, createTempWorkspace, createTool, recordCompletion, removeTempWorkspace } from './helpers';

function createBuiltInPlugins(): Plugin[] {
  return [
    {
      name: 'BuiltInPlugin',
      tools: {
        readFile: createTool('readFile'),
      },
    },
  ];
}

describe('SubAgentPlugin streaming', () => {
  test('emits delegation lifecycle events for successful runs', async () => {
    const workspaceDir = await createTempWorkspace('subagent-stream-success');
    const parts: any[] = [];

    try {
      const plugin = new SubAgentPlugin(
        new Map([
          ['Explorer', {
            name: 'Explorer',
            description: 'Codebase explorer',
            systemPrompt: 'Explore the codebase.',
            mode: 'general-purpose',
            allowedTools: ['readFile'],
          }],
        ]),
        {} as any,
        () => createBuiltInPlugins(),
        () => ({}),
        [],
        workspaceDir,
        60 * 60 * 1000,
        4,
        (config) => ({
          generate: async () => {
            await recordCompletion(config, 'done');
            return {
              text: 'done',
              steps: completionSteps('done'),
            };
          },
        } as any)
      );

      plugin.onStreamReady({ write: (part: any) => parts.push(part) } as any);
      await (plugin.tools.delegate as any).execute({ agent_name: 'Explorer', task: 'Inspect auth flow' });

      const delegationParts = parts.filter(part => part.type === 'data-delegation');
      expect(delegationParts).toHaveLength(3);
      expect(delegationParts[0].data.status).toBe('starting');
      expect(delegationParts[1].data.status).toBe('in_progress');
      expect(delegationParts[2].data.status).toBe('complete');
      expect(delegationParts[2].data.summary).toBe('done');
      expect(delegationParts[2].data.delegationId).toBeDefined();
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('emits failure events with error details', async () => {
    const workspaceDir = await createTempWorkspace('subagent-stream-failure');
    const parts: any[] = [];

    try {
      const plugin = new SubAgentPlugin(
        new Map([
          ['Explorer', {
            name: 'Explorer',
            description: 'Codebase explorer',
            systemPrompt: 'Explore the codebase.',
            mode: 'general-purpose',
            allowedTools: ['readFile'],
          }],
        ]),
        {} as any,
        () => createBuiltInPlugins(),
        () => ({}),
        [],
        workspaceDir,
        60 * 60 * 1000,
        4,
        () => ({
          generate: async () => ({
            text: 'missing completion',
            steps: [],
          }),
        } as any)
      );

      plugin.onStreamReady({ write: (part: any) => parts.push(part) } as any);
      await (plugin.tools.delegate as any).execute({ agent_name: 'Explorer', task: 'Inspect auth flow' });

      const delegationParts = parts.filter(part => part.type === 'data-delegation');
      expect(delegationParts).toHaveLength(3);
      expect(delegationParts[2].data.status).toBe('failed');
      expect(delegationParts[2].data.error).toContain('structured task_completion signal');
      expect(delegationParts[2].data.summary).toContain('did not call task_completion');
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });
});
