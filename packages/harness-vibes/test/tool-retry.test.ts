import { describe, expect, test } from 'bun:test';
import { isTransientError, wrapToolExecute } from '../src/core/agent/tool-resolution';

describe('isTransientError', () => {
    test('transient: network / rate-limit / timeout / 5xx', () => {
        expect(isTransientError(new Error('fetch failed'))).toBe(true);
        expect(isTransientError(new Error('Rate limit exceeded'))).toBe(true);
        expect(isTransientError({ message: 'boom', statusCode: 503 })).toBe(true);
        expect(isTransientError({ code: 'ETIMEDOUT', message: 'x' })).toBe(true);
        expect(isTransientError({ statusCode: 429 })).toBe(true);
    });

    test('deterministic: validation / not-found / permission / 4xx', () => {
        expect(isTransientError(new Error('Invalid argument: path required'))).toBe(false);
        expect(isTransientError(new Error('ENOENT: no such file'))).toBe(false);
        expect(isTransientError({ message: 'Forbidden', statusCode: 403 })).toBe(false);
        expect(isTransientError(null)).toBe(false);
    });
});

// Drive the wrapper directly (no stream context → runBody runs inline).
const baseDeps = (overrides: Partial<Parameters<typeof wrapToolExecute>[0]>) => ({
    toolName: 'flaky',
    ownerName: 'test',
    plugins: [],
    maxRetries: 2,
    redactToolIO: false,
    getStreamContext: () => undefined,
    logError: () => {},
    originalExecute: async () => 'ok',
    ...overrides,
});

describe('wrapToolExecute retry policy', () => {
    test('does NOT retry a deterministic error (fails fast, 1 attempt)', async () => {
        let calls = 0;
        const exec = wrapToolExecute(baseDeps({
            originalExecute: async () => { calls++; throw new Error('Invalid argument'); },
        }));
        await expect(exec({}, {})).rejects.toThrow('Invalid argument');
        expect(calls).toBe(1);
    });

    test('retries a transient error up to maxRetries, then succeeds', async () => {
        let calls = 0;
        const exec = wrapToolExecute(baseDeps({
            originalExecute: async () => {
                calls++;
                if (calls < 3) throw new Error('fetch failed');
                return 'recovered';
            },
        }));
        expect(await exec({}, {})).toBe('recovered');
        expect(calls).toBe(3); // 1 + 2 retries
    });

    test('run-wide budget stops retries once exhausted', async () => {
        let budget = 1; // only one retry allowed across the run
        const consumeRetry = () => (budget > 0 ? (budget--, true) : false);
        let calls = 0;
        const exec = wrapToolExecute(baseDeps({
            consumeRetry,
            originalExecute: async () => { calls++; throw new Error('overloaded'); },
        }));
        await expect(exec({}, {})).rejects.toThrow('overloaded');
        expect(calls).toBe(2); // initial attempt + 1 budgeted retry, then budget=0 stops it
    });
});
