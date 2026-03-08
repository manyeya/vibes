import { describe, expect, test } from 'bun:test';
import SubAgentPlugin from '../src/plugins/subagent';
import { createPluginStreamContext, type Plugin } from '../src/core/types';
import {
  completionSteps,
  createCapturingWriter,
  createStreamResult,
  createTempWorkspace,
  createTool,
  recordCompletion,
  removeTempWorkspace,
} from './helpers';

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
          stream: async () => {
            await recordCompletion(config, 'done');
            return createStreamResult('done', completionSteps('done'));
          },
        } as any)
      );

      plugin.onStreamContextReady(createPluginStreamContext(createCapturingWriter(parts)));
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
          stream: async () => createStreamResult('missing completion', []),
        } as any)
      );

      plugin.onStreamContextReady(createPluginStreamContext(createCapturingWriter(parts)));
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

  test('forwards nested child progress with delegation-scoped ids and metadata', async () => {
    const workspaceDir = await createTempWorkspace('subagent-stream-nested');
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
          stream: async (call: { writer?: { write: (part: any) => void } }) => {
            call.writer?.write({
              type: 'data-status',
              id: 'status:child-read',
              data: {
                message: 'Inspecting delegated files',
                phase: 'inspect',
              },
            });
            call.writer?.write({
              type: 'data-tool_progress',
              id: 'tool_progress:child-read',
              data: {
                toolName: 'readFile',
                stage: 'in_progress',
                message: 'Reading auth.ts',
              },
            });
            await recordCompletion(config, 'done');
            return createStreamResult('done', completionSteps('done'));
          },
        } as any)
      );

      plugin.onStreamContextReady(createPluginStreamContext(createCapturingWriter(parts)));
      await (plugin.tools.delegate as any).execute({ agent_name: 'Explorer', task: 'Inspect auth flow' });

      const completedDelegation = parts.find(
        part => part.type === 'data-delegation' && part.data.status === 'complete',
      );
      expect(completedDelegation).toBeDefined();
      const delegationId = completedDelegation.data.delegationId;

      const nestedStatus = parts.find(
        part => part.type === 'data-status' && part.id === `${delegationId}:status:child-read`,
      );
      expect(nestedStatus).toBeDefined();
      expect(nestedStatus.data.delegationId).toBe(delegationId);
      expect(nestedStatus.data.agentName).toBe('Explorer');
      expect(nestedStatus.data.parentOperationId).toBeDefined();

      const nestedProgress = parts.find(
        part => part.type === 'data-tool_progress' && part.id === `${delegationId}:tool_progress:child-read`,
      );
      expect(nestedProgress).toBeDefined();
      expect(nestedProgress.data.delegationId).toBe(delegationId);
      expect(nestedProgress.data.agentName).toBe('Explorer');
      expect(nestedProgress.data.message).toBe('Reading auth.ts');
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });
});
