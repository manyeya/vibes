import { describe, expect, test } from 'bun:test';
import { existsSync } from 'fs';
import { readFile, rm } from 'fs/promises';
import { join } from 'path';
import SubAgentPlugin from '../src/plugins/sub-agent';
import type { Plugin, AgentCoreConfig } from '../src/core/types';
import {
  completionSteps,
  completionThenTextSteps,
  completionThenToolCallSteps,
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
        list_files: createTool('list_files'),
        webSearch: createTool('webSearch'),
        create_plan: createTool('create_plan'),
        generate_tasks: createTool('generate_tasks'),
        update_task: createTool('update_task'),
        get_next_tasks: createTool('get_next_tasks'),
        list_tasks: createTool('list_tasks'),
      },
    },
  ];
}

function createPlugin(options: {
  workspaceDir: string;
  subAgents: Map<string, any>;
  capturedConfigs?: AgentCoreConfig[];
  stream?: (config: AgentCoreConfig, call: { messages?: any[] }) => Promise<any>;
}) {
  const capturedConfigs = options.capturedConfigs ?? [];
  return new SubAgentPlugin(
    options.subAgents,
    {} as any,
    () => createBuiltInPlugins(),
    () => ({ webSearch: createTool('webSearch') }),
    ['readFile'],
    options.workspaceDir,
    60 * 60 * 1000,
    4,
    (config) => {
      capturedConfigs.push(config);
      return {
        stream: (call: { messages?: any[] }) => {
          if (options.stream) {
            return options.stream(config, call);
          }
          return (async () => {
            await recordCompletion(config, 'done', ['src/example.ts'], { source: 'test' });
            return createStreamResult('done', completionSteps('done', ['src/example.ts']));
          })();
        },
      } as any;
    }
  );
}

describe('SubAgentPlugin single delegation', () => {
  test('legacy string-array tools normalize to a general-purpose subagent', async () => {
    const workspaceDir = await createTempWorkspace('subagent-legacy');
    const capturedConfigs: AgentCoreConfig[] = [];

    try {
      const plugin = createPlugin({
        workspaceDir,
        capturedConfigs,
        subAgents: new Map([
          ['Explorer', {
            name: 'Explorer',
            description: 'Codebase explorer',
            systemPrompt: 'Explore the codebase.',
            tools: ['readFile', 'list_files'],
          }],
        ]),
      });

      const result = await (plugin.tools.delegate as any).execute({
        agent_name: 'Explorer',
        task: 'Inspect the auth flow',
      });

      expect(result.status).toBe('completed');
      expect(result.completionConfirmed).toBe(true);
      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0].maxSteps).toBe(30);
      expect(capturedConfigs[0].stopWhen).toBeDefined();
      expect(capturedConfigs[0].allowedTools).toContain('readFile');
      expect(capturedConfigs[0].allowedTools).toContain('list_files');
      expect(capturedConfigs[0].allowedTools).toContain('task_completion');
      expect(capturedConfigs[0].allowedTools).not.toContain('webSearch');
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('general-purpose delegations get fresh plugin instances per run', async () => {
    const workspaceDir = await createTempWorkspace('subagent-fresh');
    const capturedConfigs: AgentCoreConfig[] = [];

    try {
      const plugin = createPlugin({
        workspaceDir,
        capturedConfigs,
        subAgents: new Map([
          ['Planner', {
            name: 'Planner',
            description: 'Planning specialist',
            systemPrompt: 'Plan precisely.',
            mode: 'general-purpose',
            allowedTools: ['create_plan', 'generate_tasks'],
          }],
        ]),
      });

      await (plugin.tools.delegate as any).execute({ agent_name: 'Planner', task: 'First run' });
      await (plugin.tools.delegate as any).execute({ agent_name: 'Planner', task: 'Second run' });

      expect(capturedConfigs).toHaveLength(2);
      expect(capturedConfigs[0].plugins).toBeDefined();
      expect(capturedConfigs[1].plugins).toBeDefined();
      expect(capturedConfigs[0].plugins?.[0]).not.toBe(capturedConfigs[1].plugins?.[0]);
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('custom subagents keep only explicit tools/plugins and block nested delegation', async () => {
    const workspaceDir = await createTempWorkspace('subagent-custom');
    const capturedConfigs: AgentCoreConfig[] = [];
    const explicitPlugin: Plugin = {
      name: 'ExplicitPlugin',
      tools: {
        custom_plugin_tool: createTool('custom_plugin_tool'),
      },
    };

    try {
      const plugin = createPlugin({
        workspaceDir,
        capturedConfigs,
        subAgents: new Map([
          ['CustomWorker', {
            name: 'CustomWorker',
            description: 'Explicit custom worker',
            systemPrompt: 'Do the explicit work only.',
            mode: 'custom',
            tools: {
              custom_tool: createTool('custom_tool'),
            },
            plugins: [explicitPlugin],
          }],
        ]),
      });

      const result = await (plugin.tools.delegate as any).execute({
        agent_name: 'CustomWorker',
        task: 'Implement one change',
      });

      expect(result.status).toBe('completed');
      expect(capturedConfigs).toHaveLength(1);
      expect(Object.keys(capturedConfigs[0].tools ?? {})).toEqual(['custom_tool', 'task_completion']);
      expect(capturedConfigs[0].plugins).toEqual([explicitPlugin]);
      expect(capturedConfigs[0].blockedTools).toEqual(expect.arrayContaining(['task', 'delegate', 'parallel_delegate']));
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('missing structured completion falls back to the sub-agent output (inferred success)', async () => {
    const workspaceDir = await createTempWorkspace('subagent-inferred');

    try {
      const plugin = createPlugin({
        workspaceDir,
        subAgents: new Map([
          ['Explorer', {
            name: 'Explorer',
            description: 'Codebase explorer',
            systemPrompt: 'Explore the codebase.',
            mode: 'general-purpose',
            allowedTools: ['readFile'],
          }],
        ]),
        // Produces output but never calls task_completion.
        stream: async () => createStreamResult('I inspected the auth flow and found two issues.', []),
      });

      const result = await (plugin.tools.delegate as any).execute({
        agent_name: 'Explorer',
        task: 'Inspect the auth flow',
      });

      expect(result.status).toBe('completed');
      expect(result.inferred).toBe(true);
      expect(result.completionConfirmed).toBe(false);
      expect(result.summary).toContain('inspected the auth flow');
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('a run that produces no output at all still fails as missing_completion', async () => {
    const workspaceDir = await createTempWorkspace('subagent-empty');

    try {
      const plugin = createPlugin({
        workspaceDir,
        subAgents: new Map([
          ['Explorer', {
            name: 'Explorer',
            description: 'Codebase explorer',
            systemPrompt: 'Explore the codebase.',
            mode: 'general-purpose',
            allowedTools: ['readFile'],
          }],
        ]),
        stream: async () => createStreamResult('   ', []),
      });

      const result = await (plugin.tools.delegate as any).execute({
        agent_name: 'Explorer',
        task: 'Inspect the auth flow',
      });

      expect(result.status).toBe('error');
      expect(result.errorCode).toBe('missing_completion');
      expect(result.savedTo).toBeDefined();
      expect(existsSync(join(workspaceDir, result.savedTo))).toBe(true);
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('trailing text after completion is harmless (still a success)', async () => {
    const workspaceDir = await createTempWorkspace('subagent-trailing-text');

    try {
      const plugin = createPlugin({
        workspaceDir,
        subAgents: new Map([
          ['Explorer', {
            name: 'Explorer',
            description: 'Codebase explorer',
            systemPrompt: 'Explore the codebase.',
            mode: 'general-purpose',
            allowedTools: ['readFile'],
          }],
        ]),
        stream: async (config) => {
          await recordCompletion(config, 'done', ['src/example.ts']);
          return createStreamResult('done then a closing remark', completionThenTextSteps('done', ['src/example.ts']));
        },
      });

      const result = await (plugin.tools.delegate as any).execute({
        agent_name: 'Explorer',
        task: 'Inspect the auth flow',
      });

      expect(result.status).toBe('completed');
      expect(result.completionConfirmed).toBe(true);
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('a tool call after completion is a real violation (post_completion_activity)', async () => {
    const workspaceDir = await createTempWorkspace('subagent-post-toolcall');

    try {
      const plugin = createPlugin({
        workspaceDir,
        subAgents: new Map([
          ['Explorer', {
            name: 'Explorer',
            description: 'Codebase explorer',
            systemPrompt: 'Explore the codebase.',
            mode: 'general-purpose',
            allowedTools: ['readFile'],
          }],
        ]),
        stream: async (config) => {
          await recordCompletion(config, 'done', ['src/example.ts']);
          return createStreamResult('done then acted', completionThenToolCallSteps('done', ['src/example.ts']));
        },
      });

      const result = await (plugin.tools.delegate as any).execute({
        agent_name: 'Explorer',
        task: 'Inspect the auth flow',
      });

      expect(result.status).toBe('error');
      expect(result.errorCode).toBe('post_completion_activity');
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('successful cache entries are invalidated if the artifact disappears', async () => {
    const workspaceDir = await createTempWorkspace('subagent-cache');
    let generateCount = 0;

    try {
      const plugin = createPlugin({
        workspaceDir,
        subAgents: new Map([
          ['Explorer', {
            name: 'Explorer',
            description: 'Codebase explorer',
            systemPrompt: 'Explore the codebase.',
            mode: 'general-purpose',
            allowedTools: ['readFile'],
          }],
        ]),
        stream: async (config, call) => {
          generateCount += 1;
          const taskText = call.messages?.[0]?.content ?? '';
          await recordCompletion(config, `run ${generateCount}`, [`src/${generateCount}.ts`]);
          return createStreamResult(
            String(taskText),
            completionSteps(`run ${generateCount}`, [`src/${generateCount}.ts`]),
          );
        },
      });

      const firstResult = await (plugin.tools.delegate as any).execute({
        agent_name: 'Explorer',
        task: 'Inspect the auth flow',
      });
      expect(firstResult.status).toBe('completed');
      expect(generateCount).toBe(1);

      await rm(join(workspaceDir, firstResult.savedTo), { force: true });

      const secondResult = await (plugin.tools.delegate as any).execute({
        agent_name: 'Explorer',
        task: 'Inspect the auth flow',
      });
      expect(secondResult.status).toBe('completed');
      expect(secondResult.cached).toBe(false);
      expect(generateCount).toBe(2);
      expect(secondResult.savedTo).toBeDefined();
      const savedContent = await readFile(join(workspaceDir, secondResult.savedTo), 'utf8');
      expect(savedContent).toContain('run 2');
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });
});
