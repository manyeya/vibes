import * as fs from 'fs/promises';
import * as path from 'path';
import { exec as nodeExec } from 'child_process';
import {
    type Sandbox,
    type ExecOptions,
    type ExecResult,
    type ListOptions,
    containPath,
} from '../core/sandbox';

export interface LocalSandboxOptions {
    /**
     * Base directory the sandbox is rooted at. Resolved against
     * `process.cwd()`. Defaults to `workspace`.
     */
    root?: string;
    /**
     * Shell used for `exec`. Defaults to `/bin/bash` so bash-isms in agent
     * commands behave consistently. Set to `/bin/sh` (or another shell) for
     * environments without bash.
     */
    shell?: string;
    /** Max stdout/stderr buffer for a command in bytes. Defaults to 64 MiB. */
    maxBuffer?: number;
}

/**
 * The default {@link Sandbox}: executes on the host filesystem and shell
 * using Node-compatible APIs only (`node:fs/promises`,
 * `node:child_process`). It runs identically under Node and Bun — no
 * `Bun.*` globals — which is what unblocks running the harness off the Bun
 * runtime.
 *
 * Every path operation is contained within {@link LocalSandbox.root} via
 * {@link containPath}, so a tool call cannot escape the workspace.
 */
export class LocalSandbox implements Sandbox {
    readonly kind = 'local' as const;
    readonly root: string;
    private readonly shell: string;
    private readonly maxBuffer: number;

    constructor(rootOrOptions: string | LocalSandboxOptions = {}) {
        const options = typeof rootOrOptions === 'string'
            ? { root: rootOrOptions }
            : rootOrOptions;
        this.root = path.resolve(process.cwd(), options.root ?? 'workspace');
        this.shell = options.shell ?? '/bin/bash';
        this.maxBuffer = options.maxBuffer ?? 64 * 1024 * 1024;
    }

    resolve(relativePath: string): string {
        return containPath(this.root, relativePath);
    }

    async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
        const cwd = options.cwd ? this.resolve(options.cwd) : this.root;
        // Ensure the working directory exists so the very first command in a
        // fresh session doesn't fail with ENOENT.
        await fs.mkdir(cwd, { recursive: true }).catch(() => { /* best effort */ });

        return await new Promise<ExecResult>((resolve) => {
            nodeExec(
                command,
                {
                    cwd,
                    env: options.env ? { ...process.env, ...options.env } : process.env,
                    timeout: options.timeoutMs,
                    signal: options.signal,
                    shell: this.shell,
                    maxBuffer: this.maxBuffer,
                },
                (error, stdout, stderr) => {
                    const out = stdout?.toString() ?? '';
                    if (error) {
                        // `error.code` is the numeric exit code for a process
                        // that ran and exited non-zero; for signals/timeouts it
                        // may be a string or undefined — fall back to 1.
                        const code = typeof (error as { code?: unknown }).code === 'number'
                            ? (error as { code: number }).code
                            : 1;
                        resolve({
                            stdout: out,
                            stderr: stderr?.toString() || error.message,
                            exitCode: code,
                        });
                        return;
                    }
                    resolve({ stdout: out, stderr: stderr?.toString() ?? '', exitCode: 0 });
                }
            );
        });
    }

    async readFile(relativePath: string): Promise<string> {
        return await fs.readFile(this.resolve(relativePath), 'utf8');
    }

    async writeFile(relativePath: string, content: string): Promise<number> {
        const full = this.resolve(relativePath);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content, 'utf8');
        return Buffer.byteLength(content, 'utf8');
    }

    async exists(relativePath: string): Promise<boolean> {
        try {
            await fs.access(this.resolve(relativePath));
            return true;
        } catch {
            return false;
        }
    }

    async mkdir(relativePath: string, options: { recursive?: boolean } = {}): Promise<void> {
        await fs.mkdir(this.resolve(relativePath), { recursive: options.recursive ?? true });
    }

    async list(relativePath: string, options: ListOptions = {}): Promise<string[]> {
        const dir = this.resolve(relativePath);
        try {
            const entries = await fs.readdir(dir, {
                withFileTypes: true,
                recursive: options.recursive ?? false,
            });
            const files: string[] = [];
            for (const entry of entries) {
                if (!entry.isFile()) continue;
                // Node 20.12+ exposes `parentPath`; older/Bun expose `path`.
                const parent =
                    (entry as { parentPath?: string }).parentPath ??
                    (entry as { path?: string }).path ??
                    dir;
                files.push(path.relative(this.root, path.join(parent, entry.name)));
            }
            return files;
        } catch {
            return [];
        }
    }

    async remove(relativePath: string, options: { recursive?: boolean } = {}): Promise<void> {
        await fs.rm(this.resolve(relativePath), {
            recursive: options.recursive ?? false,
            force: true,
        });
    }
}
