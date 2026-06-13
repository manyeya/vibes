import { describe, expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { AgentCore } from '../src/core/agent/agent-core';

// Expose the protected compression helpers for testing.
class TestAgent extends AgentCore {
  compress(msgs: ModelMessage[]) {
    return this.compressLargeContent(msgs);
  }
}

function makeAgent() {
  return new TestAgent({ model: {} as any, instructions: 'test' });
}

const big = 'X'.repeat(5000);

describe('Context compression', () => {
  test('compresses a large tool-result IN PLACE, preserving structure + toolCallId', async () => {
    const agent = makeAgent();
    const messages: any[] = [
      { role: 'user', content: 'read the file' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'readFile', input: { path: 'a.ts' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'readFile', output: { type: 'text', value: big } }] },
    ];

    const out: any[] = await agent.compress(messages);

    // tool message keeps its array-of-parts shape (NOT replaced with a string)
    const toolMsg = out[2];
    expect(toolMsg.role).toBe('tool');
    expect(Array.isArray(toolMsg.content)).toBe(true);

    const part = toolMsg.content[0];
    expect(part.type).toBe('tool-result');
    expect(part.toolCallId).toBe('c1'); // pairing preserved
    expect(part.toolName).toBe('readFile');

    // the payload is actually shrunk
    expect(part.output.value.length).toBeLessThan(big.length);
    expect(part.output.value).toContain('truncated');

    // the matching tool-call message is untouched
    expect(out[1].content[0].type).toBe('tool-call');
    expect(out[1].content[0].toolCallId).toBe('c1');
  });

  test('leaves small tool-results untouched', async () => {
    const agent = makeAgent();
    const messages: any[] = [
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'readFile', output: { type: 'text', value: 'short output' } }] },
    ];
    const out: any[] = await agent.compress(messages);
    expect(out[0].content[0].output.value).toBe('short output');
  });

  test('never replaces tool/assistant content with a bare string (no corruption)', async () => {
    const agent = makeAgent();
    const messages: any[] = [
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'bash', output: { type: 'text', value: big } }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c2', toolName: 'bash', input: { command: 'ls' } }, { type: 'text', text: big }] },
    ];
    const out: any[] = await agent.compress(messages);

    // structure stays as parts arrays
    expect(Array.isArray(out[0].content)).toBe(true);
    expect(Array.isArray(out[1].content)).toBe(true);
    // assistant tool-call survives compression (not dropped → no orphan result)
    expect(out[1].content[0].type).toBe('tool-call');
    expect(out[1].content[0].toolCallId).toBe('c2');
    // assistant's large text part is shrunk
    expect(out[1].content[1].type).toBe('text');
    expect(out[1].content[1].text.length).toBeLessThan(big.length);
  });
});
