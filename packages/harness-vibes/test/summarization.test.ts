import { describe, expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import SummarizationPlugin from '../src/plugins/summarization';

function mockModel(text = 'SUMMARY-OF-OLD-TURNS') {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { type: 'stop', unified: 'stop' },
      content: [{ type: 'text', text }],
      usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
      warnings: [],
      providerMetadata: undefined,
    } as any),
  });
}

const step = (messages: ModelMessage[], system?: string) => ({
  steps: [], stepNumber: 0, model: {} as any, messages, system,
});

describe('SummarizationPlugin trigger', () => {
  test('leaves a short conversation untouched (no compaction)', async () => {
    const p = new SummarizationPlugin(mockModel() as any, { contextWindow: 1000, compressionRatio: 0.7 });
    const res = await p.prepareStep(step([{ role: 'user', content: 'hi' }]));
    expect(res).toBeUndefined();
  });

  test('over threshold → actually compacts older turns into a summary system message', async () => {
    // compressAt = 1000 * 0.7 = 700 tokens (~2800 chars).
    const p = new SummarizationPlugin(mockModel() as any, { contextWindow: 1000, compressionRatio: 0.7 });
    const messages: ModelMessage[] = Array.from({ length: 8 }, () => ({ role: 'user', content: 'x'.repeat(600) }));
    const res = await p.prepareStep(step(messages));
    expect(res?.messages?.[0]?.role).toBe('system');
    expect(String(res?.messages?.[0]?.content)).toContain('SUMMARY-OF-OLD-TURNS');
    // It actually shrank the turn count (older turns folded into the summary).
    expect((res?.messages?.length ?? 99)).toBeLessThan(messages.length);
  });

  test('the system prompt is counted in the trigger (gauge/compaction stay consistent)', async () => {
    // Messages alone (~1980 chars ≈ 495 tok) sit UNDER the 700-tok threshold…
    const p = new SummarizationPlugin(mockModel() as any, { contextWindow: 1000, compressionRatio: 0.7 });
    const messages: ModelMessage[] = Array.from({ length: 6 }, () => ({ role: 'user', content: 'x'.repeat(330) }));

    const withoutSystem = await p.prepareStep(step(messages));
    expect(withoutSystem).toBeUndefined(); // not over threshold yet

    // …but a big system prompt (~2000 chars ≈ 500 tok) pushes it over → compacts.
    const p2 = new SummarizationPlugin(mockModel() as any, { contextWindow: 1000, compressionRatio: 0.7 });
    const withSystem = await p2.prepareStep(step(messages, 'S'.repeat(2000)));
    // A limit-warning system message may precede the summary once the effective
    // payload is this tight, so find the summary rather than assuming index 0.
    const summary = withSystem?.messages?.find((m) => String(m.content).includes('SUMMARY-OF-OLD-TURNS'));
    expect(summary?.role).toBe('system');
  });
});
