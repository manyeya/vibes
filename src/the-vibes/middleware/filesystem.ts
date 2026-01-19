import { tool, type UIMessageStreamWriter } from "ai";
import { AgentUIMessage, Middleware } from "../core/types";
import z from "zod";
import { $ } from "bun";
import * as path from "node:path";

/**
 * Middleware that grants the agent access to a specific directory
 * on the host filesystem. Use Bun's native performance.
 */
export default class FilesystemMiddleware implements Middleware {
    name = 'FilesystemMiddleware';
    private writer?: UIMessageStreamWriter<AgentUIMessage>;
    private baseDir: string;

    constructor(baseDir: string = 'workspace') {
        this.baseDir = path.resolve(process.cwd(), baseDir);
    }

    onStreamReady(writer: UIMessageStreamWriter<AgentUIMessage>) {
        this.writer = writer;
    }

    private resolvePath(relativePath: string): string {
        return path.resolve(this.baseDir, relativePath);
    }

    get tools() {
        return {

            readFile: tool({
                description: 'Read the contents of a file from the workspace.',
                inputSchema: z.object({
                    path: z.string().describe('Relative path to the file from the workspace root'),
                }),
                execute: async ({ path: relativePath }) => {
                    try {
                        const fullPath = this.resolvePath(relativePath);
                        const file = Bun.file(fullPath);
                        if (!await file.exists()) {
                            return { error: `File not found: ${relativePath} in workspace` };
                        }
                        const content = await file.text();
                        return { content };
                    } catch (error: any) {
                        return { error: error.message };
                    }
                },
            }),

            writeFile: tool({
                description: 'Write content to a file in the workspace. Overwrites if exists. Creates parent directories.',
                inputSchema: z.object({
                    path: z.string().describe('Relative path to the file in the workspace'),
                    content: z.string().describe('Content to write'),
                }),
                execute: async ({ path: relativePath, content }) => {
                    try {
                        const fullPath = this.resolvePath(relativePath);
                        const bytes = await Bun.write(fullPath, content);
                        return { success: true, bytesWritten: bytes, savedTo: relativePath };
                    } catch (error: any) {
                        return { error: error.message };
                    }
                },
            }),

            list_files: tool({
                description: 'List files in the workspace recursively or at root.',
                inputSchema: z.object({
                    directory: z.string().optional().default('.').describe('Directory to list, relative to workspace'),
                    recursive: z.boolean().optional().default(false).describe('Whether to list recursively'),
                }),
                execute: async ({ directory, recursive }) => {
                    try {
                        const globPattern = recursive ? `${directory}/**/*` : `${directory}/*`;
                        const glob = new Bun.Glob(globPattern);
                        const files = [];
                        for await (const file of glob.scan(this.baseDir)) {
                            files.push(file);
                        }
                        return { files };
                    } catch (error: any) {
                        return { error: error.message };
                    }
                },
            }),
        };
    }

    modifySystemPrompt(prompt: string): string {
        return `${prompt}

## Workspace & Filesystem
You have direct access to your designated workspace via FilesystemMiddleware.
- Your workspace root is: ${this.baseDir}
- Use readFile() and writeFile() to manage files in your workspace.
- Use list_files() to explore your workspace structure.
- **Sub-agent results** are saved to \`subagent_results/\` within your workspace. Always read them to understand sub-agent work.
- Treat this workspace as your primary repository for manuscripts, code, and findings.`;
    }
}
