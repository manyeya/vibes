import { tool, type UIMessageStreamWriter } from "ai";
import {
    VibesUIMessage,
    Plugin,
    PluginStreamContext,
    createDataStreamWriter,
    type DataStreamWriter,
} from "../core/types";
import z from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { type Sandbox } from "../core/sandbox";
import { LocalSandbox } from "../sandbox/local-sandbox";

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
 * Constructor config for {@link FilesystemPlugin}.
 *
 * Pass a `sandbox` to route all file I/O through any {@link Sandbox}
 * implementation. Otherwise a default {@link LocalSandbox} is created from
 * `baseDir`. `trackedFilesPath` is plugin-internal bookkeeping and is
 * persisted directly (it may live outside the sandbox root).
 */
export interface FilesystemPluginConfig {
    baseDir?: string;
    trackedFilesPath?: string;
    sandbox?: Sandbox;
}

/**
 * Plugin that grants the agent access to a sandboxed workspace directory.
 * File reads/writes/listing are delegated to the {@link Sandbox}, so the
 * plugin no longer depends on Bun's `Bun.file`/`Bun.write`/`Bun.Glob`.
 */
export default class FilesystemPlugin implements Plugin {
    name = 'FilesystemPlugin';
    private writer?: DataStreamWriter;
    private streamContext?: PluginStreamContext;
    private sandbox: Sandbox;
    private baseDir: string;
    private trackedFilesPath: string;
    private trackedFiles: Set<string> = new Set();

    constructor(config: FilesystemPluginConfig = {}) {
        this.sandbox = config.sandbox ?? new LocalSandbox(config.baseDir ?? 'workspace');
        this.baseDir = this.sandbox.root;
        this.trackedFilesPath = config.trackedFilesPath || path.join(this.baseDir, 'tracked_files.json');
    }

    async waitReady(): Promise<void> {
        await this.loadTrackedFiles();
    }

    onStreamContextReady(context: PluginStreamContext) {
        this.streamContext = context;
        this.writer = context.writer.withDefaults({ plugin: this.name });
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.streamContext = undefined;
        this.writer = createDataStreamWriter(writer).withDefaults({ plugin: this.name });
    }

    /**
     * Track a file in the current session
     */
    private async trackFile(filePath: string): Promise<void> {
        if (!this.trackedFiles.has(filePath)) {
            this.trackedFiles.add(filePath);
            await this.persistTrackedFiles();
        }
    }

    private async persistTrackedFiles(): Promise<void> {
        try {
            const fullPath = path.resolve(process.cwd(), this.trackedFilesPath);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, JSON.stringify(Array.from(this.trackedFiles), null, 2), 'utf8');
        } catch (e) {
            console.error('[FilesystemPlugin] Failed to persist tracked files:', e);
        }
    }

    private async loadTrackedFiles(): Promise<void> {
        try {
            const fullPath = path.resolve(process.cwd(), this.trackedFilesPath);
            const content = await fs.readFile(fullPath, 'utf8');
            const files = JSON.parse(content) as string[];
            this.trackedFiles = new Set(files);
        } catch (e) {
            this.trackedFiles = new Set();
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
                    const operation = this.streamContext?.createOperation({
                        name: 'read-file',
                        toolName: 'readFile',
                        plugin: this.name,
                        heartbeatEnabled: false,
                    });
                    operation?.milestone(`Resolving ${relativePath}`, { phase: 'resolve' });
                    const opId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                    this.writer?.writeFileOperation(opId, 'read', relativePath, 'running');
                    if (!await this.sandbox.exists(relativePath)) {
                        throw new Error(`File not found: ${relativePath} in workspace`);
                    }
                    operation?.milestone(`Reading ${relativePath}`, { phase: 'read' });
                    const content = await this.sandbox.readFile(relativePath);
                    operation?.complete(`Read ${relativePath}`, { phase: 'complete' });
                    this.writer?.writeFileOperation(opId, 'read', relativePath, 'complete', { bytes: content.length });
                    return { content };
                },
            }),

            writeFile: tool({
                description: 'Write content to a file in the workspace. Overwrites if exists. Creates parent directories.',
                inputSchema: z.object({
                    path: z.string().describe('Relative path to the file in the workspace'),
                    content: z.string().describe('Content to write'),
                }),
                execute: async ({ path: relativePath, content }) => {
                    const operation = this.streamContext?.createOperation({
                        name: 'write-file',
                        toolName: 'writeFile',
                        plugin: this.name,
                        heartbeatEnabled: false,
                    });

                    // sandbox.writeFile creates parent directories; we still
                    // surface the 'mkdir' milestone for UI parity.
                    operation?.milestone(`Ensuring directory exists for ${relativePath}`, { phase: 'mkdir' });
                    const opId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                    this.writer?.writeFileOperation(opId, 'write', relativePath, 'running');
                    operation?.milestone(`Writing ${relativePath}`, { phase: 'write' });
                    const bytes = await this.sandbox.writeFile(relativePath, content);

                    // Track the file in the current session
                    operation?.milestone(`Tracking ${relativePath}`, { phase: 'track' });
                    await this.trackFile(relativePath);
                    operation?.complete(`Wrote ${relativePath}`, { phase: 'complete' });
                    this.writer?.writeFileOperation(opId, 'write', relativePath, 'complete', { bytes });

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
                    const operation = this.streamContext?.createOperation({
                        name: 'list-files',
                        toolName: 'list_files',
                        plugin: this.name,
                        heartbeatEnabled: false,
                    });
                    operation?.milestone(`Scanning ${directory}${recursive ? ' recursively' : ''}`, { phase: 'scan' });
                    const opId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                    this.writer?.writeFileOperation(opId, 'list', directory, 'running');
                    const files = await this.sandbox.list(directory, { recursive });
                    operation?.complete(`Found ${files.length} file${files.length === 1 ? '' : 's'}`, {
                        phase: 'complete',
                    });
                    this.writer?.writeFileOperation(opId, 'list', directory, 'complete', {
                        fileCount: files.length,
                        files: files.slice(0, 20),
                    });
                    return { files };
                },
            }),
        };
    }

    modifySystemPrompt(prompt: string): string {
        return `${prompt}

## Workspace & Filesystem
You have access to a sandboxed workspace directory.
- Your workspace root is: ${this.baseDir}
- Use readFile() and writeFile() to manage files in your workspace.
- Use list_files() to explore your workspace structure.
- **Sub-agent results** are saved to \`subagent_results/\` within your workspace. Use the structured delegation result first; read the artifact only when the summary is insufficient or you need audit/debug detail.
- Treat this workspace as your primary repository for manuscripts, code, and findings.`;
    }
}
