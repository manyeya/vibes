import { describe, expect, test } from 'bun:test';
import { existsSync } from 'fs';
import { readFile, rm } from 'fs/promises';
import { join } from 'path';
import SubAgentPlugin from '../src/plugins/sub-agent';
import type { Plugin, AgentHarnessConfig } from '../src/core/types';
import {
  completionSteps,
  completionThenTextSteps,
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
  capturedConfigs?: AgentHarnessConfig[];
  stream?: (config: AgentHarnessConfig, call: { messages?: any[] }) => Promise<any>;
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
    const capturedConfigs: AgentHarnessConfig[] = [];

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
      expect(capturedConfigs[0].maxSteps).toBe(25);
      // Natural completion: no forced stopWhen on the report tool anymore.
      expect(capturedConfigs[0].stopWhen).toBeUndefined();
      expect(capturedConfigs[0].allowedTools).toContain('readFile');
      expect(capturedConfigs[0].allowedTools).toContain('list_files');
      expect(capturedConfigs[0].allowedTools).toContain('report_result');
      expect(capturedConfigs[0].allowedTools).not.toContain('webSearch');
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('delegated agents are bounded by loop detection + budgets, not just maxSteps', async () => {
    const workspaceDir = await createTempWorkspace('subagent-bounds');
    const capturedConfigs: AgentHarnessConfig[] = [];

    try {
      const plugin = createPlugin({
        workspaceDir,
        capturedConfigs,
        subAgents: new Map([
          ['Explorer', {
            name: 'Explorer',
            description: 'Codebase explorer',
            systemPrompt: 'Explore the codebase.',
            tools: ['readFile'],
          }],
        ]),
      });

      await (plugin.tools.delegate as any).execute({ agent_name: 'Explorer', task: 'Inspect' });

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0].loopDetection).toBeDefined();
      expect(capturedConfigs[0].budgets?.maxToolCalls).toBeGreaterThan(0);
      expect(capturedConfigs[0].budgets?.maxTotalTokens).toBeGreaterThan(0);
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('general-purpose delegations get fresh plugin instances per run', async () => {
    const workspaceDir = await createTempWorkspace('subagent-fresh');
    const capturedConfigs: AgentHarnessConfig[] = [];

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
    const capturedConfigs: AgentHarnessConfig[] = [];
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
      expect(Object.keys(capturedConfigs[0].tools ?? {})).toEqual(['custom_tool', 'report_result']);
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
        // Produces a final answer but never calls report_result.
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

  test('a run that produces no output at all fails as no_output', async () => {
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
      expect(result.errorCode).toBe('no_output');
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

  test('a run with only tool actions (no final text/report) succeeds with a step summary', async () => {
    const workspaceDir = await createTempWorkspace('subagent-steps-only');

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
        // No final text and no report — but it did call a tool.
        stream: async () => createStreamResult('', [
          { content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'readFile', input: { path: 'a.ts' } }] },
        ]),
      });

      const result = await (plugin.tools.delegate as any).execute({
        agent_name: 'Explorer',
        task: 'Inspect the auth flow',
      });

      expect(result.status).toBe('completed');
      expect(result.inferred).toBe(true);
      expect(result.summary).toContain('readFile');
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('create_agent registers a runtime sub-agent that delegate can then use', async () => {
    const workspaceDir = await createTempWorkspace('subagent-create');

    try {
      const plugin = createPlugin({
        workspaceDir,
        subAgents: new Map(),
        stream: async () => createStreamResult('Investigated and wrote the report.', []),
      });

      // No agents to start with.
      const before = await (plugin.tools.list_agents as any).execute({});
      expect(before.agents).toHaveLength(0);

      const created = await (plugin.tools.create_agent as any).execute({
        name: 'MigrationWriter',
        description: 'Writes DB migrations',
        system_prompt: 'You write careful migrations.',
        allowed_tools: ['readFile', 'writeFile_does_not_exist'],
      });
      expect(created.ok).toBe(true);
      expect(created.availableTools).toContain('readFile');
      // Unknown tools are reported but don't crash.
      expect(created.ignoredUnknownTools).toContain('writeFile_does_not_exist');

      const after = await (plugin.tools.list_agents as any).execute({});
      expect(after.agents.map((a: any) => a.name)).toContain('MigrationWriter');

      const result = await (plugin.tools.delegate as any).execute({
        agent_name: 'MigrationWriter',
        task: 'Add a users table migration',
      });
      expect(result.status).toBe('completed');
      expect(result.summary).toContain('Investigated');
    } finally {
      await removeTempWorkspace(workspaceDir);
    }
  });

  test('spawn_agent defines and runs a one-off agent in a single call', async () => {
    const workspaceDir = await createTempWorkspace('subagent-spawn');
    const capturedConfigs: AgentHarnessConfig[] = [];

    try {
      const plugin = createPlugin({
        workspaceDir,
        capturedConfigs,
        subAgents: new Map(),
        stream: async () => createStreamResult('One-off task done.', []),
      });

      const result = await (plugin.tools.spawn_agent as any).execute({
        task: 'Summarize the README',
        system_prompt: 'You summarize docs.',
        allowed_tools: ['readFile'],
      });

      expect(result.status).toBe('completed');
      expect(result.summary).toContain('One-off task done');
      expect(capturedConfigs).toHaveLength(1);
      // The spawned agent is registered and listable.
      const listed = await (plugin.tools.list_agents as any).execute({});
      expect(listed.agents).toHaveLength(1);
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
