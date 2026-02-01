import { tool, type UIMessageStreamWriter } from "ai";
import { AgentUIMessage, Middleware } from "../core/types";
import z from "zod";
import { $ } from "bun";
import * as path from "path";
import StateBackend from "../backend/statebackend";

/**
 * Get file type from extension
 */
function getFileType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const typeMap: Record<string, string> = {
        '.ts': 'typescript',
        '.tsx': 'typescript-react',
        '.js': 'javascript',
        '.jsx': 'javascript-react',
        '.py': 'python',
        '.rs': 'rust',
        '.go': 'go',
        '.java': 'java',
        '.cpp': 'cpp',
        '.c': 'c',
        '.h': 'c-header',
        '.css': 'css',
        '.scss': 'scss',
        '.html': 'html',
        '.json': 'json',
        '.md': 'markdown',
        '.txt': 'text',
        '.xml': 'xml',
        '.yaml': 'yaml',
        '.yml': 'yaml',
        '.toml': 'toml',
        '.sql': 'sql',
        '.sh': 'shell',
        '.bash': 'shell',
        '.zsh': 'shell',
        '.fish': 'shell',
        '.ps1': 'powershell',
    };
    return typeMap[ext] || 'unknown';
}

/**
 * Middleware that grants the agent access to a specific directory
 * on the host filesystem. Use Bun's native performance.
 */
export default class FilesystemMiddleware implements Middleware {
    name = 'FilesystemMiddleware';
    private writer?: UIMessageStreamWriter<AgentUIMessage>;
    private baseDir: string;
    private backend?: StateBackend;

    constructor(baseDir: string = 'workspace', backend?: StateBackend) {
        this.baseDir = path.resolve(process.cwd(), baseDir);
        this.backend = backend;
    }

    onStreamReady(writer: UIMessageStreamWriter<AgentUIMessage>) {
        this.writer = writer;
    }

    private resolvePath(relativePath: string): string {
        return path.resolve(this.baseDir, relativePath);
    }

    /**
     * Track a file in the current session
     */
    private async trackFile(filePath: string): Promise<void> {
        if (this.backend && 'addFile' in this.backend) {
            try {
                await (this.backend as any).addFile(filePath, getFileType(filePath));
            } catch (error) {
                // Silently fail if file tracking doesn't work
                console.error('[FilesystemMiddleware] Failed to track file:', error);
            }
        }
    }

    get tools() {
        return {

            readFile: tool({
                description: 'Read the contents of a file from the workspace.',
                inputSchema: z.object({
                    path: z.string().describe('Relative path to the file from the workspace root'),
                }),
                execute: async ({ path: relativePath }) => {
                    const fullPath = this.resolvePath(relativePath);
                    const file = Bun.file(fullPath);
                    if (!await file.exists()) {
                        throw new Error(`File not found: ${relativePath} in workspace`);
                    }
                    return { content: await file.text() };
                },
            }),

            writeFile: tool({
                description: 'Write content to a file in the workspace. Overwrites if exists. Creates parent directories.',
                inputSchema: z.object({
                    path: z.string().describe('Relative path to the file in the workspace'),
                    content: z.string().describe('Content to write'),
                }),
                execute: async ({ path: relativePath, content }) => {
                    const fullPath = this.resolvePath(relativePath);

                    // Ensure parent directory exists
                    const parentDir = path.dirname(fullPath);
                    await $`mkdir -p ${parentDir}`.quiet();

                    const bytes = await Bun.write(fullPath, content);

                    // Track the file in the current session
                    await this.trackFile(relativePath);

                    return { success: true, bytesWritten: bytes, savedTo: relativePath };
                },
            }),

            list_files: tool({
                description: 'List files in the workspace recursively or at root.',
                inputSchema: z.object({
                    directory: z.string().optional().default('.').describe('Directory to list, relative to workspace'),
                    recursive: z.boolean().optional().default(false).describe('Whether to list recursively'),
                }),
                execute: async ({ directory, recursive }) => {
                    const globPattern = recursive ? `${directory}/**/*` : `${directory}/*`;
                    const glob = new Bun.Glob(globPattern);
                    const files = [];
                    for await (const file of glob.scan(this.baseDir)) {
                        files.push(file);
                    }
                    return { files };
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
