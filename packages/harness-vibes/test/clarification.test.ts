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
        { question: 'Anything else to note?', kind: 'text' },
      ],
    });

    const clar = parts.find((p) => p.type === 'data-clarification');
    expect(clar).toBeDefined();
    expect(clar.data.title).toBe('Scope');
    expect(clar.data.questions).toHaveLength(2);
    // questions get stable ids + carry their kind/options
    expect(clar.data.questions[0].id).toBe('q1');
    expect(clar.data.questions[0].options).toEqual(['Postgres', 'SQLite']);
    expect(clar.data.questions[1].kind).toBe('text');

    // the tool result steers the model to stop and wait for the answers
    expect(result.status).toBe('awaiting_user_answers');
    expect(result.questionCount).toBe(2);
    expect(result.message.toLowerCase()).toContain('wait');
  });
});
