import { describe, expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { VibesAgent } from '../src/core/agent/agent';

// Expose the protected compression helpers for testing.
class TestAgent extends VibesAgent {
  compress(msgs: ModelMessage[]) {
    return this.compressLargeContent(msgs);
  }
  prune(msgs: ModelMessage[]) {
    return this.pruneMessages(msgs);
  }
}

function makeAgent(config: Record<string, unknown> = {}) {
  return new TestAgent({ model: {} as any, instructions: 'test', ...config });
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

describe('Compression gating (phase 1 by context budget)', () => {
  const bigRead = (): any[] => [
    { role: 'user', content: 'read the file' },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'readFile', input: { path: 'a.ts' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'readFile', output: { type: 'text', value: big } }] },
  ];

  test('keeps a large read VERBATIM while the context has headroom', async () => {
    // Default 128k window → ~5k-char read is ~1.3k tokens, far below the gate.
    const agent = makeAgent();
    const out: any[] = await agent.prune(bigRead());
    expect(out[2].content[0].output.value).toBe(big); // untouched
    expect(out[2].content[0].output.value).not.toContain('truncated');
  });

  test('compresses the same read once the conversation nears the window', async () => {
    // Tiny window so the ~1.3k-token conversation is over the 0.7 gate but
    // under the 0.95 emergency ceiling (no message dropping).
    const agent = makeAgent({ contextWindow: 1500 });
    const out: any[] = await agent.prune(bigRead());
    expect(out).toHaveLength(3); // nothing dropped
    expect(out[2].content[0].output.value.length).toBeLessThan(big.length);
    expect(out[2].content[0].output.value).toContain('truncated');
  });

  test('compressionGateRatio: 0 restores eager compression', async () => {
    const agent = makeAgent({ compressionGateRatio: 0 });
    const out: any[] = await agent.prune(bigRead());
    expect(out[2].content[0].output.value).toContain('truncated');
  });
});
