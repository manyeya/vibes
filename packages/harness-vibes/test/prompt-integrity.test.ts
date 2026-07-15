import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { VibeAgent, VIBE_BASE_INSTRUCTIONS } from '../src/core/agent/vibe-agent';
import { vibePrompt } from '../../../apps/api/src/prompts/vibe';
import { createTempWorkspace, removeTempWorkspace } from './helpers';

const mockModel = new MockLanguageModelV3({
    doGenerate: async () => ({
        finishReason: { type: 'stop', unified: 'stop' },
        content: [{ type: 'text', text: 'ok' }],
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
        providerMetadata: undefined,
    } as any),
});

/** Assemble the system prompt exactly like AgentHarness.prepareCallOverride:
 *  base instructions → every plugin's modifySystemPrompt in registration
 *  order → the Custom Instructions layer. */
async function assemblePrompt(agent: VibeAgent): Promise<string> {
    let prompt: string = VIBE_BASE_INSTRUCTIONS;
    for (const plugin of (agent as any).plugins) {
        if (typeof plugin.waitReady === 'function') await plugin.waitReady().catch(() => {});
        if (typeof plugin.modifySystemPrompt === 'function') {
            prompt = await plugin.modifySystemPrompt(prompt);
        }
    }
    return `${prompt}\n\n## Custom Instructions\n${vibePrompt}`;
}

describe('prompt integrity', () => {
    test('assembled prompt references only real tools, in cache-friendly order', async () => {
        const root = await createTempWorkspace('prompt-integrity');
        try {
            const agent = new VibeAgent({
                model: mockModel as any,
                workspaceDir: root,
                subAgents: [
                    {
                        name: 'dummy',
                        description: 'placeholder specialist',
                        systemPrompt: 'You are dummy.',
                        mode: 'general-purpose',
                        allowedTools: ['bash'],
                    } as any,
                ],
            });
            const prompt = await assemblePrompt(agent);

            // (a) Relics of the old prompt stack must never come back.
            // (`write_file` alone is NOT banned: it's a legitimate workflow-DSL
            // action kind; tool-style misuse is caught by check (b) below.)
            for (const banned of [
                'write_todos',
                'save_reflection',
                'SuperCoder',
                'BrowserAgent',
                '`view_file`',
                'Use `write_file`',
                'Chief Architect',
                'Awwwards',
            ]) {
                expect(prompt).not.toContain(banned);
            }

            // (b) Every `name(` tool reference in prompt text resolves to a
            // registered plugin tool.
            const registry = new Set<string>();
            for (const plugin of (agent as any).plugins) {
                const tools = typeof plugin.tools === 'function' ? plugin.tools() : plugin.tools;
                for (const key of Object.keys(tools ?? {})) registry.add(key);
            }
            const refs = [...prompt.matchAll(/`([a-z_][a-z0-9_]*)\(/gi)].map((m) => m[1]!);
            expect(refs.length).toBeGreaterThan(0);
            for (const ref of refs) {
                expect(registry.has(ref), `prompt references unknown tool \`${ref}()\``).toBe(true);
            }

            // (c) Volatile sections trail the stable prefix.
            const artifactIdx = prompt.indexOf('## Canvas Artifacts');
            const delegationIdx = prompt.indexOf('## Sub-Agent Delegation');
            const scratchpadIdx = prompt.indexOf('## Scratchpad');
            const customIdx = prompt.indexOf('## Custom Instructions');
            expect(artifactIdx).toBeGreaterThan(-1);
            expect(delegationIdx).toBeGreaterThan(artifactIdx);
            expect(scratchpadIdx).toBeGreaterThan(delegationIdx);
            expect(customIdx).toBeGreaterThan(scratchpadIdx);
        } finally {
            await removeTempWorkspace(root);
        }
    });
});
