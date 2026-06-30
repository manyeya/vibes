import { describe, expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { repairToolPairs } from '../src/core/agent/message-compression';

const asstCall = (id: string, name = 'bash'): ModelMessage =>
    ({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName: name, input: {} }] } as any);

const toolResult = (id: string, name = 'bash'): ModelMessage =>
    ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: name, output: { type: 'text', value: 'ok' } }] } as any);

const userMsg = (text: string): ModelMessage => ({ role: 'user', content: text } as any);

const firstToolResult = (m: ModelMessage) =>
    (m.content as any[]).find(p => p.type === 'tool-result');

describe('repairToolPairs', () => {
    test('leaves a valid call→result pair untouched', () => {
        const msgs = [userMsg('hi'), asstCall('a'), toolResult('a')];
        expect(repairToolPairs(msgs)).toEqual(msgs);
    });

    test('synthesizes a placeholder result for an orphaned call', () => {
        const msgs = [userMsg('hi'), asstCall('a')]; // result truncated away
        const out = repairToolPairs(msgs);
        expect(out.length).toBe(3);
        expect(out[2].role).toBe('tool');
        const result = firstToolResult(out[2]);
        expect(result.toolCallId).toBe('a');
        expect(result.output.type).toBe('error-text');
    });

    test('drops an orphaned result whose call was truncated (leading dangling)', () => {
        const msgs = [toolResult('a'), userMsg('next'), asstCall('b'), toolResult('b')];
        const out = repairToolPairs(msgs);
        // The leading dangling tool result is gone; the valid b-pair remains.
        expect(out.map(m => m.role)).toEqual(['user', 'assistant', 'tool']);
    });

    test('repairs a partial multi-call turn (one answered, one orphaned)', () => {
        const msgs: ModelMessage[] = [
            { role: 'assistant', content: [
                { type: 'tool-call', toolCallId: 'a', toolName: 'read', input: {} },
                { type: 'tool-call', toolCallId: 'b', toolName: 'read', input: {} },
            ] } as any,
            toolResult('a', 'read'), // only 'a' answered
        ];
        const out = repairToolPairs(msgs);
        const resultIds = out
            .filter(m => m.role === 'tool')
            .flatMap(m => (m.content as any[]).filter(p => p.type === 'tool-result').map(p => p.toolCallId));
        expect(new Set(resultIds)).toEqual(new Set(['a', 'b']));
    });
});
