import * as fs from "fs/promises";
import {
    createBashTool,
    type BashToolkit,
    type CommandResult,
    type Sandbox as BashToolSandbox,
} from "bash-tool";
import { Bash, ReadWriteFs } from "just-bash";
import {
    VibesUIMessage,
    Plugin,
    PluginStreamContext,
    type DataStreamWriter,
} from "../core/types";
import { type Sandbox } from "../core/sandbox";
import { LocalSandbox } from "../sandbox/local-sandbox";

/**
 * Constructor options for {@link BashPlugin}.
 *
 * Pass a `sandbox` to root the shell at any {@link Sandbox}'s workspace
 * directory. Pass `baseDir` (or a bare string, kept for backwards
 * compatibility) to root it at a path directly.
 */
export type BashPluginOptions = string | { sandbox?: Sandbox; baseDir?: string };

/**
 * Grants the agent a `bash` tool backed by Vercel Labs' `bash-tool` +
 * `just-bash` — an in-process bash interpreter, not the host shell. Commands
 * resolve against just-bash's built-in command set (ls, cat, grep, sed, find,
 * pipes, redirects, globs, control flow); host binaries (node, git, npm,
 * python) are unavailable, so the agent can't shell out of the box.
 *
 * The interpreter is rooted at the workspace via a {@link ReadWriteFs}, so its
 * files live on the real directory on disk — the same one the filesystem and
 * artifact plugins read/write through — keeping the shell and file views in
 * sync. The plugin keeps `bash-tool`'s tool definition/prompt and layers the
 * activity-rail streaming on top via the sandbox adapter's `executeCommand`.
 *
 * Bash is just bash: running commands and exploring the workspace. Reading,
 * writing and editing file *content* is the job of the dedicated file tools
 * (`readFile` / `writeFile` / `edit_file`) in {@link FilesystemPlugin}.
 */
export default class BashPlugin implements Plugin {
    name = 'BashPlugin';
    private writer?: DataStreamWriter;
    private streamContext?: PluginStreamContext;
    private sandbox: Sandbox;
    private baseDir: string;
    /** The `bash-tool` toolkit, built once in {@link waitReady}. */
    private bashTool?: BashToolkit['tools']['bash'];

    constructor(options: BashPluginOptions = 'workspace') {
        if (typeof options === 'string') {
            this.sandbox = new LocalSandbox(options);
        } else if (options.sandbox) {
            this.sandbox = options.sandbox;
        } else {
            this.sandbox = new LocalSandbox(options.baseDir ?? 'workspace');
        }
        this.baseDir = this.sandbox.root;
    }

    onStreamContextReady(context: PluginStreamContext) {
        this.streamContext = context;
        this.writer = context.writer.withDefaults({ plugin: this.name });
    }

    /**
     * Build the `bash-tool` toolkit. Async (createBashTool is async), so it runs
     * in the plugin readiness phase — AgentHarness awaits every `waitReady` before
     * it reads `tools`, so the built tool is in place by collection time.
     */
    async waitReady(): Promise<void> {
        if (this.bashTool) return;

        // just-bash interpreter rooted at the workspace on real disk, shared
        // with the filesystem/artifact tools (which use node fs against the same
        // directory), so the two views never diverge. ReadWriteFs requires the
        // root to exist, so ensure it (the session dir may not be created yet).
        await fs.mkdir(this.baseDir, { recursive: true }).catch(() => { /* best effort */ });
        const engine = new Bash({
            fs: new ReadWriteFs({ root: this.baseDir }),
            cwd: '/',
            // Give `sleep` real semantics (just-bash no-ops it by default); it's
            // async (setTimeout), so it never blocks the event loop.
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            // Defense-in-depth monkey-patches setTimeout/eval/Function during
            // execution to contain the `js-exec` command. We don't enable
            // js-exec, so that secondary layer only gets in the way (it blocks
            // the sleep timer above); the interpreter + ReadWriteFs containment
            // remain the primary sandbox.
            defenseInDepth: false,
        });

        // A custom Sandbox (per bash-tool's interface) that runs commands
        // through just-bash and reports each one to the activity rail.
        const adapter: BashToolSandbox = {
            executeCommand: (command) => this.runCommand(engine, command),
            readFile: (path) => engine.readFile(path),
            writeFiles: async (files) => {
                for (const file of files) {
                    const content = typeof file.content === 'string'
                        ? file.content
                        : file.content.toString();
                    await engine.writeFile(file.path, content);
                }
            },
        };

        const toolkit = await createBashTool({
            // The interpreter's root maps to the workspace; commands run from here.
            destination: '/',
            sandbox: adapter,
        });
        this.bashTool = toolkit.tools.bash;
    }

    /**
     * Translate absolute host paths that point INTO the workspace root into the
     * interpreter's virtual root. just-bash mounts the workspace at `/`, so a
     * command using the real on-disk path (e.g. `ls /Users/me/repo/src` when the
     * workspace IS /Users/me/repo) would otherwise resolve *below* the root
     * (`/Users/me/repo/Users/me/repo/src`) and fail with "No such file or
     * directory". Rewriting the prefix to `/` makes those commands just work.
     */
    private toWorkspacePath(command: string): string {
        const root = this.baseDir.replace(/\/+$/, '');
        if (!root || root === '/') return command;
        const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return command
            // "<root>/foo" → "/foo"
            .replace(new RegExp(escaped + '/', 'g'), '/')
            // bare "<root>" (followed by space / quote / end) → "/"
            .replace(new RegExp(escaped + `(?=\\s|$|["'\`])`, 'g'), '/');
    }

    /** Run one command through just-bash, streaming its lifecycle to the UI. */
    private async runCommand(engine: Bash, command: string): Promise<CommandResult> {
        const normalized = this.toWorkspacePath(command);
        const operation = this.streamContext?.createOperation({
            name: 'bash-command',
            toolName: 'bash',
            plugin: this.name,
        });
        // bash-tool prepends `cd "<destination>" && ` to every command so it runs
        // in the working dir; strip that bookkeeping from what the UI card shows
        // (the real command still runs with it). Destination is the root ("/").
        const display = normalized.replace(/^cd "\/" && /, '');
        const preview = display.length > 120 ? `${display.slice(0, 117)}...` : display;
        const cmdId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const trunc = (s: string) => (s.length > 600 ? `${s.slice(0, 600)}…` : s);

        operation?.milestone(`Running command: ${preview}`, { phase: 'execute' });
        this.writer?.writeCommand(cmdId, display, 'running');

        const res = await engine.exec(normalized, { rawScript: true });
        const result: CommandResult = {
            stdout: res.stdout ?? '',
            stderr: res.stderr ?? '',
            exitCode: res.exitCode ?? 0,
        };

        operation?.complete(`Command finished with exit code ${result.exitCode}`, { phase: 'complete' });
        this.writer?.writeCommand(cmdId, display, 'complete', {
            exitCode: result.exitCode,
            stdout: trunc(result.stdout),
            stderr: trunc(result.stderr),
        });
        return result;
    }

    get tools(): Record<string, any> {
        if (!this.bashTool) return {};
        return { bash: this.bashTool };
    }

    modifySystemPrompt(prompt: string): string {
        return `${prompt}

## Bash
You have a \`bash\` tool: an in-process shell whose working directory IS the root
of your workspace. Refer to files by paths RELATIVE to that root — \`ls\`,
\`cat README.md\`, \`grep -r foo src\`, \`find . -name '*.ts'\` — or by an absolute
path under \`/\`, which maps to the workspace root (\`/README.md\` is the same file
as \`README.md\`). Do NOT prefix paths with the workspace's host location
(\`${this.baseDir}\`): inside the shell that resolves *below* the root and fails
with "No such file or directory".

Use it to explore and search the codebase, inspect files, and chain commands with
pipes, redirects and globs. Note: only the built-in shell commands are available
(ls, cat, grep, sed, find, awk, …); host tools such as git, node, npm and python
are not.`;
    }
}
