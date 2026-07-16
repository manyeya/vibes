import { describe, expect, test } from 'bun:test';
import GuardrailsPlugin, { GuardrailError, type Guardrail } from '../src/plugins/guardrails';
import { redactString, redactSecrets } from '../src/core/redact';

const userMsg = (text: string) => ({ role: 'user' as const, content: text });

describe('redactSecrets', () => {
    test('masks known secret shapes', () => {
        expect(redactString('key is sk-ABCDEF0123456789ABCD')).toContain('***REDACTED***');
        expect(redactString('aws AKIAIOSFODNN7EXAMPLE here')).toContain('***REDACTED***');
        expect(redactString('Authorization: Bearer abcdef123456')).toContain('***REDACTED***');
        const env = redactString('OPENAI_API_KEY=sk-xyz9876543210abcddef');
        expect(env).toContain('OPENAI_API_KEY=');     // key kept
        expect(env).toContain('***REDACTED***');        // value masked
    });

    test('leaves benign text and structure intact', () => {
        expect(redactString('just a normal sentence')).toBe('just a normal sentence');
        const out = redactSecrets({ a: 'sk-ABCDEF0123456789ABCD', b: 'fine', n: 5 });
        expect(out.a).toContain('***REDACTED***');
        expect(out.b).toBe('fine');
        expect(out.n).toBe(5);
    });
});

describe('GuardrailsPlugin', () => {
    test('input block guardrail throws and halts the run', async () => {
        const block: Guardrail = {
            name: 'no-secrets',
            stage: 'input',
            check: () => ({ action: 'block', message: 'request rejected' }),
        };
        const plugin = new GuardrailsPlugin({ guardrails: [block], maskSecrets: false });
        await expect(
            plugin.prepareTurn({ stepNumber: 0, messages: [userMsg('do the thing')] as any }),
        ).rejects.toBeInstanceOf(GuardrailError);
    });

    test('input redact guardrail rewrites the user message', async () => {
        const plugin = new GuardrailsPlugin({ maskSecrets: true }); // built-in secret-mask
        const result: any = await plugin.prepareTurn({
            stepNumber: 0,
            messages: [userMsg('my token is sk-ABCDEF0123456789ABCD ok')] as any,
        });
        expect(result?.messages).toBeDefined();
        const content = JSON.stringify(result.messages[0].content);
        expect(content).toContain('***REDACTED***');
        expect(content).not.toContain('sk-ABCDEF0123456789ABCD');
    });

    test('does not gate later steps (input runs at step 0 only)', async () => {
        const plugin = new GuardrailsPlugin({ maskSecrets: true });
        const result = await plugin.prepareTurn({
            stepNumber: 3,
            messages: [userMsg('sk-ABCDEF0123456789ABCD')] as any,
        });
        expect(result).toBeUndefined();
    });

    test('clean input passes through untouched', async () => {
        const plugin = new GuardrailsPlugin({ maskSecrets: true });
        const result = await plugin.prepareTurn({
            stepNumber: 0,
            messages: [userMsg('please refactor the parser')] as any,
        });
        expect(result).toBeUndefined();
    });
});
