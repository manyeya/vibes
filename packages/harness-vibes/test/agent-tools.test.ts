import { describe, expect, test } from 'bun:test';
import { tool } from 'ai';
import z from 'zod';
import { AgentHarness } from '../src/core/agent/agent-harness';
import { createPluginStreamContext } from '../src/core/types';
import { createCapturingWriter, createTool } from './helpers';

class ExposedVibeAgent extends AgentHarness {
  async exposeGetAllTools(allowedTools?: string[]) {
    return this.getAllTools(allowedTools);
  }

  exposeSetStreamContext(parts: any[]) {
    this.activeStreamContext = createPluginStreamContext(createCapturingWriter(parts));
  }

  async exposePrepareCall(instructions: string) {
    return this.prepareCallOverride({ instructions } as any) as Promise<{ instructions: string }>;
  }
}

describe('AgentHarness tool filtering', () => {
  test('allowedTools limits the runtime catalog', async () => {
    const agent = new ExposedVibeAgent({
      model: {} as any,
      instructions: 'test',
      tools: {
        alpha: createTool('alpha'),
        beta: createTool('beta'),
      },
      allowedTools: ['alpha'],
    });

    const tools = await agent.exposeGetAllTools();
    expect(Object.keys(tools)).toEqual(['alpha']);
  });

  test('blockedTools overrides allowedTools', async () => {
    const agent = new ExposedVibeAgent({
      model: {} as any,
      instructions: 'test',
      tools: {
        alpha: createTool('alpha'),
        beta: createTool('beta'),
      },
      allowedTools: ['alpha', 'beta'],
      blockedTools: ['beta'],
    });

    const tools = await agent.exposeGetAllTools();
    expect(Object.keys(tools)).toEqual(['alpha']);
  });

  test('wrapped tools emit baseline start and terminal progress events', async () => {
    const parts: any[] = [];
    const agent = new ExposedVibeAgent({
      model: {} as any,
      instructions: 'test',
      maxRetries: 0,
      plugins: [
        {
          name: 'ProgressPlugin',
          tools: {
            alpha: tool({
              description: 'alpha tool',
              inputSchema: z.object({}),
              execute: async () => ({ ok: true }),
            }),
          },
        },
      ],
    });

    agent.exposeSetStreamContext(parts);
    const tools = await agent.exposeGetAllTools();
    await (tools.alpha as any).execute({}, {});

    const toolProgress = parts.filter(
      part => part.type === 'data-tool_progress' && part.data.toolName === 'alpha',
    );
    expect(toolProgress.map(part => part.data.stage)).toEqual([
      'starting',
      'in_progress',
      'complete',
    ]);
    expect(toolProgress.every(part => part.data.plugin === 'ProgressPlugin')).toBe(true);
    expect(toolProgress.at(-1)?.data.attempt).toBe(1);
  });

  test('injects the current date/time into the system prompt each turn', async () => {
    const agent = new ExposedVibeAgent({ model: {} as any, instructions: 'BASE INSTRUCTIONS' });
    const { instructions } = await agent.exposePrepareCall('BASE INSTRUCTIONS');

    expect(instructions).toContain('<environment>');
    expect(instructions).toContain('Current date and time:');
    // The real current year, proving it's computed live (not frozen/static).
    expect(instructions).toContain(String(new Date().getFullYear()));
    // Appended AFTER the base prompt, so the stable prefix stays KV-cacheable.
    expect(instructions.indexOf('BASE INSTRUCTIONS')).toBeLessThan(instructions.indexOf('<environment>'));
  });

  test('wrapped tools emit retry and failure metadata on terminal errors', async () => {
    const parts: any[] = [];
    let attempts = 0;

    const agent = new ExposedVibeAgent({
      model: {} as any,
      instructions: 'test',
      maxRetries: 1,
      plugins: [
        {
          name: 'RetryPlugin',
          tools: {
            flaky: tool({
              description: 'flaky tool',
              inputSchema: z.object({}),
              execute: async () => {
                attempts += 1;
                throw new Error(`boom-${attempts}`);
              },
            }),
          },
        },
      ],
    });

    agent.exposeSetStreamContext(parts);
    const tools = await agent.exposeGetAllTools();

    await expect((tools.flaky as any).execute({}, {})).rejects.toThrow('boom-2');

    const toolProgress = parts.filter(
      part => part.type === 'data-tool_progress' && part.data.toolName === 'flaky',
    );
    expect(toolProgress.map(part => part.data.stage)).toEqual([
      'starting',
      'in_progress',
      'in_progress',
      'failed',
    ]);
    expect(toolProgress.at(-1)?.data.attempt).toBe(2);
    expect(toolProgress.at(-1)?.data.plugin).toBe('RetryPlugin');

    const errorPart = parts.find(part => part.type === 'data-error');
    expect(errorPart).toBeDefined();
    expect(errorPart.data.toolName).toBe('flaky');
    expect(errorPart.data.attempt).toBe(2);
    expect(errorPart.data.plugin).toBe('RetryPlugin');
  });
});
