import { tool } from "ai";
import { Middleware } from ".";
import StateBackend from "../backend/statebackend";
import z from "zod";
import { $ } from "bun";


/**
 * Middleware that provides persistent memory capabilities:
 * 1. Scratchpad: A "thinking file" for the current session state.
 * 2. Reflexion: A "lessons learned" file for cross-session improvement.
 */
export default class MemoryMiddleware implements Middleware {
    name = 'MemoryMiddleware';

    // Paths are relative to the wrapper's working directory (usually user workspace)
    private scratchpadPath = 'workspace/scratchpad.md';
    private reflexionPath = 'workspace/reflections.md';

    // Cache for sync prompt injection
    private scratchpadContent = '';
    private reflexionContent = '';

    constructor(private backend: StateBackend) { }

    async waitReady() {
        // Ensure workspace directory exists using Bun Shell
        try {
            await $`mkdir -p workspace`;
        } catch (e) {
            // Ignore (already exists or permission error handled by runtime)
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
                    // Bun.write overwrites by default
                    await Bun.write(this.scratchpadPath, content);

                    // Update cache immediately so it's fresh for next turn
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

                    // Efficient append using current content + new entry
                    // (Bun doesn't have a direct 'append' flag for write yet, other than streams)
                    const file = Bun.file(this.reflexionPath);
                    const current = await file.exists() ? await file.text() : '';
                    await Bun.write(this.reflexionPath, current + entry);

                    // Update cache
                    this.reflexionContent = current + entry;
                    return { success: true, message: 'Reflection saved.' };
                },
            }),
        };
    }

    modifySystemPrompt(prompt: string): string {
        // Use preloaded content
        let memorySection = '\n\n# Memory Systems\n';
        memorySection += `\n## Current Scratchpad (Your cognitive state)\n${this.scratchpadContent}\n`;
        memorySection += `\n## Lessons Learned (Reflexions)\n${this.reflexionContent}\n`;

        return prompt + memorySection;
    }
}
