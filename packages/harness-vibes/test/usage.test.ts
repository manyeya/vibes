import { describe, expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { VibesAgent } from '../src/core/agent/agent';
import { createPluginStreamContext } from '../src/core/types';
import { createCapturingWriter } from './helpers';

// Expose the protected usage helpers.
class UsageAgent extends VibesAgent {
  setEstimate(n: number) { (this as unknown as { lastContextEstimate: number }).lastContextEstimate = n; }
  record(step: unknown) { (this as unknown as { recordStepUsage(s: unknown): void }).recordStepUsage(step); }
  estimate(system: string, msgs: ModelMessage[]) {
    return (this as unknown as { estimateContextTokens(s: string, m: ModelMessage[]): number }).estimateContextTokens(system, msgs);
  }
  /** Attach a capturing stream writer so writeContextGauge has somewhere to emit. */
  attachWriter(parts: any[]) {
    (this as unknown as { activeStreamContext: unknown }).activeStreamContext =
      createPluginStreamContext(createCapturingWriter(parts));
  }
}

const makeAgent = (config: Record<string, unknown> = {}) =>
  new UsageAgent({ model: {} as any, instructions: 'test', ...config });

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

describe('Context gauge emission', () => {
  test('recording usage emits a data-context_usage gauge with the configured window', () => {
    const parts: any[] = [];
    const a = makeAgent({ contextWindow: 200_000, contextCompressionRatio: 0.7 });
    a.attachWriter(parts);
    a.record({ usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 } });

    const gauge = parts.find((p) => p.type === 'data-context_usage');
    expect(gauge).toBeTruthy();
    // Fullness = latest step's input + output (ground truth from the provider).
    expect(gauge.data.usedTokens).toBe(1200);
    // The model's REAL window must drive the gauge — not the 128k default.
    expect(gauge.data.contextWindow).toBe(200_000);
    expect(gauge.data.compressAt).toBe(Math.round(200_000 * 0.7));
  });

  test('setContextWindow moves the gauge to the active model window (per-model, C1)', () => {
    const parts: any[] = [];
    const a = makeAgent({ contextWindow: 128_000 });
    a.attachWriter(parts);
    a.setContextWindow(1_000_000); // e.g. swapping to a 1M-context model
    a.record({ usage: { inputTokens: 500, outputTokens: 0, totalTokens: 500 } });

    const gauge = parts.filter((p) => p.type === 'data-context_usage').pop();
    expect(gauge.data.contextWindow).toBe(1_000_000);
  });

  test('falls back to the context estimate for the gauge when usage is omitted', () => {
    const parts: any[] = [];
    const a = makeAgent({ contextWindow: 64_000 });
    a.attachWriter(parts);
    a.setEstimate(900);
    a.record({ usage: undefined });

    const gauge = parts.find((p) => p.type === 'data-context_usage');
    expect(gauge?.data.usedTokens).toBe(900);
    expect(gauge?.data.contextWindow).toBe(64_000);
  });
});
