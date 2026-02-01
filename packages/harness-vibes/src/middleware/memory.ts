import { tool } from "ai";
import { Middleware } from "../core/types";
import z from "zod";

/**
 * Middleware that provides persistent memory capabilities:
 * 1. Scratchpad: A "thinking file" for the current session state.
 * 2. Reflexion: A "lessons learned" file for cross-session improvement.
 */
export default class MemoryMiddleware implements Middleware {
    name = 'MemoryMiddleware';

    private scratchpadPath: string;
    private reflexionPath: string;

    // Cache for sync prompt injection
    private scratchpadContent = '';
    private reflexionContent = '';

    constructor(config: { scratchpadPath?: string, reflexionPath?: string } = {}) {
        this.scratchpadPath = config.scratchpadPath || 'workspace/scratchpad.md';
        this.reflexionPath = config.reflexionPath || 'workspace/reflections.md';
    }

    async waitReady() {
        // Ensure workspace directory exists using Bun Shell
        try {
            const { $ } = await import('bun');
            await $`mkdir -p workspace`.quiet();
        } catch (e) {
            // Ignore
        }
    }

    async beforeModel(state: any) {
        // Preload content asynchronously using Bun File API
        try {
            const scratchFile = Bun.file(this.scratchpadPath);
            this.scratchpadContent = await scratchFile.exists()
                ? await scratchFile.text()
                : 'No active scratchpad.';
        } catch (e) {
            this.scratchpadContent = 'No active scratchpad.';
        }

        try {
            const reflexionFile = Bun.file(this.reflexionPath);
            this.reflexionContent = await reflexionFile.exists()
                ? await reflexionFile.text()
                : 'No reflections yet.';
        } catch (e) {
            this.reflexionContent = 'No reflections yet.';
        }
    }

    get tools() {
        return {
            update_scratchpad: tool({
                description: `Update your scratchpad. Use this to keep track of your current plan, thoughts, and status.
This file is ALWAYS visible to you in your system prompt.
Overwrite the entire file with the new content.`,
                inputSchema: z.object({
                    content: z.string().describe('The new content of the scratchpad. Be detailed.'),
                }),
                execute: async ({ content }) => {
                    await Bun.write(this.scratchpadPath, content);
                    this.scratchpadContent = content;
                    return { success: true, message: 'Scratchpad updated.' };
                },
            }),
            save_reflection: tool({
                description: `Save a lesson learned or reflection for future reference.
Use this when you complete a significant task or learn something new about the user/project.
This will be appended to your long-term memory.`,
                inputSchema: z.object({
                    lesson: z.string().describe('The lesson, insight, or reflection to save.'),
                }),
                execute: async ({ lesson }) => {
                    const entry = `\n- [${new Date().toISOString()}] ${lesson}`;
                    const file = Bun.file(this.reflexionPath);
                    const current = await file.exists() ? await file.text() : '';
                    await Bun.write(this.reflexionPath, current + entry);
                    this.reflexionContent = current + entry;
                    return { success: true, message: 'Reflection saved.' };
                },
            }),
        };
    }

    modifySystemPrompt(prompt: string): string {
        let memorySection = '\n\n# Memory Systems\n';
        memorySection += `\n## Current Scratchpad (Your cognitive state)\n${this.scratchpadContent}\n`;
        memorySection += `\n## Lessons Learned (Reflexions)\n${this.reflexionContent}\n`;

        return prompt + memorySection;
    }
}
