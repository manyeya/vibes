import { describe, expect, test } from 'bun:test';
import ClarificationPlugin, { ASK_USER_TOOL_NAME } from '../src/plugins/clarification';
import { createPluginStreamContext } from '../src/core/types';
import { createCapturingWriter } from './helpers';

describe('ClarificationPlugin', () => {
  test('ask_user emits a questionnaire and tells the agent to wait', async () => {
    const parts: any[] = [];
    const plugin = new ClarificationPlugin();
    plugin.onStreamContextReady(createPluginStreamContext(createCapturingWriter(parts)));

    const result: any = await (plugin.tools[ASK_USER_TOOL_NAME] as any).execute({
      title: 'Scope',
      questions: [
        { question: 'Which database?', kind: 'single', options: ['Postgres', 'SQLite'] },
        { question: 'Which features?', kind: 'multi', options: ['Auth', 'Billing', 'Search'], min: 1, max: 2 },
        { question: 'Responsive?', kind: 'boolean' },
        { question: 'Budget?', kind: 'number', unit: '$', min: 0 },
        { question: 'Anything else to note?', kind: 'text', required: false },
      ],
    });

    const clar = parts.find((p) => p.type === 'data-clarification');
    expect(clar).toBeDefined();
    expect(clar.data.title).toBe('Scope');
    expect(clar.data.questions).toHaveLength(5);
    // stable ids + each kind's fields pass through normalization
    expect(clar.data.questions[0].id).toBe('q1');
    expect(clar.data.questions[0].options).toEqual(['Postgres', 'SQLite']);
    expect(clar.data.questions[1].kind).toBe('multi');
    expect(clar.data.questions[1].min).toBe(1);
    expect(clar.data.questions[1].max).toBe(2);
    expect(clar.data.questions[2].kind).toBe('boolean');
    expect(clar.data.questions[3].kind).toBe('number');
    expect(clar.data.questions[3].unit).toBe('$');
    expect(clar.data.questions[4].required).toBe(false);

    // the tool result steers the model to stop and wait for the answers
    expect(result.status).toBe('awaiting_user_answers');
    expect(result.questionCount).toBe(5);
    expect(result.message.toLowerCase()).toContain('wait');
  });
});
