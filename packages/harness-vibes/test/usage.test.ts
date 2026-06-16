import { describe, expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { AgentCore } from '../src/core/agent/agent-core';

// Expose the protected usage helpers.
class UsageAgent extends AgentCore {
  setEstimate(n: number) { (this as unknown as { lastContextEstimate: number }).lastContextEstimate = n; }
  record(step: unknown) { (this as unknown as { recordStepUsage(s: unknown): void }).recordStepUsage(step); }
  estimate(system: string, msgs: ModelMessage[]) {
    return (this as unknown as { estimateContextTokens(s: string, m: ModelMessage[]): number }).estimateContextTokens(system, msgs);
  }
}

const makeAgent = () => new UsageAgent({ model: {} as any, instructions: 'test' });

describe('Token usage accounting', () => {
  test('accumulates the provider-reported usage', () => {
    const a = makeAgent();
    a.record({ usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } });
    a.record({ usage: { inputTokens: 200, outputTokens: 30, totalTokens: 230 } });
    expect(a.consumeLastStreamUsage()).toEqual({ inputTokens: 300, outputTokens: 50, totalTokens: 350 });
  });

  test('derives a missing total from input + output', () => {
    const a = makeAgent();
    a.record({ usage: { inputTokens: 80, outputTokens: 20 } });
    expect(a.consumeLastStreamUsage().totalTokens).toBe(100);
  });

  test('falls back to the context estimate when the provider omits usage', () => {
    const a = makeAgent();
    a.setEstimate(500);
    a.record({ usage: undefined });
    const u = a.consumeLastStreamUsage();
    expect(u.inputTokens).toBe(500);
    expect(u.totalTokens).toBe(500);
  });

  test('no usage and no estimate → no phantom spend', () => {
    const a = makeAgent();
    a.record({ usage: undefined });
    expect(a.consumeLastStreamUsage().totalTokens).toBe(0);
  });

  test('estimateContextTokens scales with system + message size (chars/4)', () => {
    const a = makeAgent();
    const msgs: ModelMessage[] = [
      { role: 'user', content: 'x'.repeat(400) },
      { role: 'assistant', content: 'y'.repeat(400) },
    ];
    // ~ (8 system + 800 message) / 4
    expect(a.estimate('sysprompt', msgs)).toBe(Math.round((9 + 800) / 4));
  });
});
