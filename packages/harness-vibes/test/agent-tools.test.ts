import { describe, expect, test } from 'bun:test';
import { VibeAgent } from '../src/core/agent';
import { createTool } from './helpers';

class ExposedVibeAgent extends VibeAgent {
  async exposeGetAllTools(allowedTools?: string[]) {
    return this.getAllTools(allowedTools);
  }
}

describe('VibeAgent tool filtering', () => {
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
});
