import { describe, expect, test } from 'bun:test';
import { classifyComplexity, reasoningProviderOptions } from '../src/core/agent/reasoning';

describe('classifyComplexity', () => {
    test('hard keywords → high', () => {
        expect(classifyComplexity('Refactor the auth module')).toBe('high');
        expect(classifyComplexity('debug this race condition')).toBe('high');
    });

    test('short trivial request → low', () => {
        expect(classifyComplexity('list the files')).toBe('low');
        expect(classifyComplexity('rename foo to bar')).toBe('low');
    });

    test('plain request → medium', () => {
        expect(classifyComplexity('Add a button to the page')).toBe('medium');
    });

    test('very long request → high', () => {
        expect(classifyComplexity('a'.repeat(700))).toBe('high');
    });

    test('a recent error escalates one notch', () => {
        expect(classifyComplexity('list the files', true)).toBe('medium'); // low → medium
        expect(classifyComplexity('Add a button', true)).toBe('high');     // medium → high
    });
});

describe('reasoningProviderOptions', () => {
    test('emits openai + openrouter namespaces by default', () => {
        const opts = reasoningProviderOptions('high') as any;
        expect(opts.openai.reasoningEffort).toBe('high');
        expect(opts.openrouter.reasoning.effort).toBe('high');
        expect(opts.anthropic).toBeUndefined();
    });

    test('adds anthropic thinking only when opted in', () => {
        const off = reasoningProviderOptions('high', {}) as any;
        expect(off.anthropic).toBeUndefined();
        const on = reasoningProviderOptions('high', { enableAnthropicThinking: true }) as any;
        expect(on.anthropic.thinking.type).toBe('enabled');
        const low = reasoningProviderOptions('low', { enableAnthropicThinking: true }) as any;
        expect(low.anthropic.thinking.type).toBe('disabled');
    });
});
