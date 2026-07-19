import * as path from 'path';

/**
 * Sandbox abstraction (Phase 1).
 *
 * The Sandbox is the single boundary through which the agent touches the
 * outside world's filesystem and shell. Plugins (BashPlugin,
 * FilesystemPlugin, …) depend on this interface, which means:
 *
 *   - **Safety**: every structured path operation (read/write/list/…) is
 *     contained within the sandbox root, so a tool call cannot read or
 *     write outside the workspace. (`exec` runs a real shell rooted at the
 *     root but is not jailed — see {@link Sandbox.exec} / LocalSandbox.)
 *   - **Swappability**: the default `LocalSandbox` runs on the host, using
 *     Bun's `$` for the shell. A future `RemoteSandbox` (container) can drop
 *     in without touching a single plugin.
 *
 * All `relativePath` arguments are resolved against — and contained
 * within — the sandbox `root`. Passing an absolute path or a `..` that
 * escapes the root throws.
 */

export type SandboxKind = 'local' | 'virtual' | 'remote';

export interface ExecResult {
    /** Standard output captured from the command. */
    stdout: string;
    /** Standard error captured from the command. */
    stderr: string;
    /** Process exit code. 0 on success; non-zero indicates failure. */
    exitCode: number;
}

export interface ExecOptions {
    /** Working directory for the command, relative to the sandbox root. Defaults to the root. */
    cwd?: string;
    /** Extra environment variables, merged over the host environment. */
    env?: Record<string, string>;
    /** Hard timeout in milliseconds. The command is killed if it exceeds this. */
    timeoutMs?: number;
    /** Abort signal to cancel the command. */
    signal?: AbortSignal;
}

export interface ListOptions {
    /** Recurse into subdirectories. Defaults to false (immediate children only). */
    recursive?: boolean;
}

/**
 * The execution environment an agent operates within. Implementations
 * MUST contain all path operations within {@link Sandbox.root}.
 */
export interface Sandbox {
    /** Discriminator for the concrete implementation. */
    readonly kind: SandboxKind;
    /** Absolute base directory. All relative paths resolve under this. */
    readonly root: string;

    /** Run a shell command. Resolves with the captured result; never throws on a non-zero exit. */
    exec(command: string, options?: ExecOptions): Promise<ExecResult>;

    /** Read a UTF-8 file. Throws if the file does not exist. */
    readFile(relativePath: string): Promise<string>;

    /** Write a UTF-8 file, creating parent directories. Returns the number of bytes written. */
    writeFile(relativePath: string, content: string): Promise<number>;

    /** True if the path exists. */
    exists(relativePath: string): Promise<boolean>;

    /** Create a directory (recursive by default). */
    mkdir(relativePath: string, options?: { recursive?: boolean }): Promise<void>;

    /** List files under a directory, returning paths relative to the sandbox root. */
    list(relativePath: string, options?: ListOptions): Promise<string[]>;

    /** Remove a file or directory. */
    remove(relativePath: string, options?: { recursive?: boolean }): Promise<void>;

    /** Resolve a relative path to an absolute one, contained within the root. Throws on escape. */
    resolve(relativePath: string): string;
}

/**
 * Resolve `relativePath` against `root` and guarantee the result stays
 * inside `root`. Throws on path traversal (`..`) or absolute paths that
 * escape the root. This is the security primitive every filesystem-backed
 * Sandbox implementation should use.
 */
export function containPath(root: string, relativePath: string): string {
    const normalizedRoot = path.resolve(root);
    const resolved = path.resolve(normalizedRoot, relativePath);
    if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
        throw new Error(
            `Path "${relativePath}" escapes the sandbox root (${normalizedRoot})`
        );
    }
    return resolved;
}
