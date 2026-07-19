import * as fs from 'fs/promises';
import * as path from 'path';
import { $ } from 'bun';
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
}

/**
 * The default {@link Sandbox}: filesystem via `node:fs/promises`, shell via
 * Bun's shell (`Bun.$`). Vibes is Bun-only, so `exec` runs real commands
 * through Bun's cross-platform shell — host binaries (git, node, npm, python,
 * …) are available, unlike the old in-process just-bash interpreter.
 *
 * Every *path* operation is contained within {@link LocalSandbox.root} via
 * {@link containPath}. Note that `exec` runs a real shell rooted at `root` but
 * is NOT jailed — a command can `cd` elsewhere and touch anything the user
 * can. That is intentional (a real shell is the point); path containment only
 * covers the structured read/write/list methods.
 */
export class LocalSandbox implements Sandbox {
    readonly kind = 'local' as const;
    readonly root: string;

    constructor(rootOrOptions: string | LocalSandboxOptions = {}) {
        const options = typeof rootOrOptions === 'string'
            ? { root: rootOrOptions }
            : rootOrOptions;
        this.root = path.resolve(process.cwd(), options.root ?? 'workspace');
    }

    resolve(relativePath: string): string {
        return containPath(this.root, relativePath);
    }

    async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
        const cwd = options.cwd ? this.resolve(options.cwd) : this.root;
        // Ensure the working directory exists so the very first command in a
        // fresh session doesn't fail with ENOENT.
        await fs.mkdir(cwd, { recursive: true }).catch(() => { /* best effort */ });

        // `{ raw: command }` hands the whole string to Bun's shell to parse
        // (pipes, redirects, &&, globs); `.nothrow()` keeps the "never throws
        // on non-zero" contract; `.quiet()` buffers output instead of echoing.
        // ponytail: no timeoutMs/signal — Bun's ShellPromise exposes no abort
        // or timeout knob (Bun 1.3), and the old just-bash tool had none
        // either, so no regression. Upgrade path if runaway commands bite:
        // route through `Bun.spawn` (supports `timeout` + `signal` + kill).
        const result = await $`${{ raw: command }}`
            .cwd(cwd)
            .env({ ...process.env, ...(options.env ?? {}) })
            .nothrow()
            .quiet();

        return {
            stdout: result.stdout.toString(),
            stderr: result.stderr.toString(),
            exitCode: result.exitCode,
        };
    }

    async readFile(relativePath: string): Promise<string> {
        return await Bun.file(this.resolve(relativePath)).text();
    }

    async writeFile(relativePath: string, content: string): Promise<number> {
        // Bun.write creates parent directories and returns the byte count.
        return await Bun.write(this.resolve(relativePath), content);
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
