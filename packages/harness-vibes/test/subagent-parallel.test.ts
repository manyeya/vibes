import { describe, expect, test } from 'bun:test';
import SubAgentPlugin from '../src/plugins/subagent';
import type { Plugin, VibeAgentConfig } from '../src/core/types';
import {
  completionSteps,
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

function createParallelPlugin(options: {
  workspaceDir: string;
  maxConcurrentAgents: number;
  generate: (config: VibeAgentConfig, call: { messages?: any[] }) => Promise<any>;
}) {
  return new SubAgentPlugin(
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
    options.workspaceDir,
    60 * 60 * 1000,
    options.maxConcurrentAgents,
    (config) => ({
      generate: (call: { messages?: any[] }) => options.generate(config, call),
    } as any)
  );
}

describe('SubAgentPlugin parallel delegation', () => {
  test('respects maxConcurrentAgents', async () => {
    const workspaceDir = await createTempWorkspace('subagent-parallel-concurrency');
    let active = 0;
    let maxSeen = 0;

    try {
      const plugin = createParallelPlugin({
        workspaceDir,
        maxConcurrentAgents: 2,
        generate: async (config) => {
          active += 1;
          maxSeen = Math.max(maxSeen, active);
          await Bun.sleep(20);
          await recordCompletion(config, 'done');
          active -= 1;
          return {
            text: 'done',
            steps: completionSteps('done'),
          };
        },
      });

      const result = await (plugin.tools.parallel_delegate as any).execute({
        tasks: [
          { agent_name: 'Explorer', task: 'Task 1' },
          { agent_name: 'Explorer', task: 'Task 2' },
          { agent_name: 'Explorer', task: 'Task 3' },
        ],
        continueOnError: true,
      });

      expect(result.completed).toBe(3);
      expect(result.failed).toBe(0);
      expect(maxSeen).toBe(2);
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('stops scheduling new tasks after the first failure when continueOnError is false', async () => {
    const workspaceDir = await createTempWorkspace('subagent-parallel-stop');
    let calls = 0;

    try {
      const plugin = createParallelPlugin({
        workspaceDir,
        maxConcurrentAgents: 1,
        generate: async (config, call) => {
          calls += 1;
          const taskText = String(call.messages?.[0]?.content ?? '');
          if (taskText.includes('Task 1')) {
            return {
              text: 'failed before completion',
              steps: [],
            };
          }
          await recordCompletion(config, 'done');
          return {
            text: 'done',
            steps: completionSteps('done'),
          };
        },
      });

      const result = await (plugin.tools.parallel_delegate as any).execute({
        tasks: [
          { agent_name: 'Explorer', task: 'Task 1' },
          { agent_name: 'Explorer', task: 'Task 2' },
          { agent_name: 'Explorer', task: 'Task 3' },
        ],
        continueOnError: false,
      });

      expect(result.stoppedEarly).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(false);
      expect(calls).toBe(1);
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('continues through failures when continueOnError is true', async () => {
    const workspaceDir = await createTempWorkspace('subagent-parallel-continue');
    let calls = 0;

    try {
      const plugin = createParallelPlugin({
        workspaceDir,
        maxConcurrentAgents: 1,
        generate: async (config, call) => {
          calls += 1;
          const taskText = String(call.messages?.[0]?.content ?? '');
          if (taskText.includes('Task 2')) {
            return {
              text: 'failed before completion',
              steps: [],
            };
          }
          await recordCompletion(config, 'done');
          return {
            text: 'done',
            steps: completionSteps('done'),
          };
        },
      });

      const result = await (plugin.tools.parallel_delegate as any).execute({
        tasks: [
          { agent_name: 'Explorer', task: 'Task 1' },
          { agent_name: 'Explorer', task: 'Task 2' },
          { agent_name: 'Explorer', task: 'Task 3' },
        ],
        continueOnError: true,
      });

      expect(result.stoppedEarly).toBe(false);
      expect(result.results).toHaveLength(3);
      expect(result.completed).toBe(2);
      expect(result.failed).toBe(1);
      expect(calls).toBe(3);
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });
});
