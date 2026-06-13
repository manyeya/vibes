import * as fs from "fs/promises";
import { tool, type Tool, type UIMessageStreamWriter } from "ai";
import z from "zod";
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
    createDataStreamWriter,
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
 */
export default class BashPlugin implements Plugin {
    name = 'BashPlugin';
    private writer?: DataStreamWriter;
    private streamContext?: PluginStreamContext;
    private sandbox: Sandbox;
    private baseDir: string;
    /** The `bash-tool` toolkit, built once in {@link waitReady}. */
    private bashTool?: BashToolkit['tools']['bash'];
    /** The just-bash interpreter, reused by `bash` and `edit_file`. */
    private engine?: Bash;
    /** Structured surgical-edit tool, built once in {@link waitReady}. */
    private editTool?: Tool<any, any>;

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

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.streamContext = undefined;
        this.writer = createDataStreamWriter(writer).withDefaults({ plugin: this.name });
    }

    /**
     * Build the `bash-tool` toolkit. Async (createBashTool is async), so it runs
     * in the plugin readiness phase — AgentCore awaits every `waitReady` before
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
        // edit_file shares the SAME interpreter, so its reads/writes hit exactly
        // the filesystem the shell sees.
        this.engine = engine;
        this.editTool = this.makeEditTool();
    }

    /** Run one command through just-bash, streaming its lifecycle to the UI. */
    private async runCommand(engine: Bash, command: string): Promise<CommandResult> {
        const operation = this.streamContext?.createOperation({
            name: 'bash-command',
            toolName: 'bash',
            plugin: this.name,
            heartbeatMessage: `Shell command is still running in ${this.baseDir}`,
        });
        // bash-tool prepends `cd "<destination>" && ` to every command so it runs
        // in the working dir; strip that bookkeeping from what the UI card shows
        // (the real command still runs with it). Destination is the root ("/").
        const display = command.replace(/^cd "\/" && /, '');
        const preview = display.length > 120 ? `${display.slice(0, 117)}...` : display;
        const cmdId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const trunc = (s: string) => (s.length > 600 ? `${s.slice(0, 600)}…` : s);

        operation?.milestone(`Running command: ${preview}`, { phase: 'execute' });
        this.writer?.writeCommand(cmdId, display, 'running');

        const res = await engine.exec(command, { rawScript: true });
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

    /**
     * The `edit_file` tool: a surgical exact-string replacement done in the
     * interpreter's filesystem (no shell, no regex/escaping), which sidesteps
     * sed-dialect and quoting fragility and streams a real diff card.
     */
    private makeEditTool(): Tool<any, any> {
        return tool({
            description:
                'Make a surgical edit to an EXISTING file by replacing an exact string. ' +
                'Preferred over sed/awk for changing code: no regex or shell escaping, and it ' +
                'shows a diff. old_string must match the file exactly (including indentation) ' +
                'and be unique, unless replace_all is set. To create a new file, use bash (heredoc).',
            inputSchema: z.object({
                path: z.string().describe('Relative path to the file in the workspace'),
                old_string: z.string().describe('Exact text to replace — must be unique in the file unless replace_all'),
                new_string: z.string().describe('Replacement text'),
                replace_all: z.boolean().optional().describe('Replace every occurrence instead of requiring a unique match'),
            }),
            execute: async ({ path: relativePath, old_string, new_string, replace_all }) => {
                const engine = this.engine;
                if (!engine) throw new Error('edit_file is not ready');
                if (old_string === new_string) {
                    throw new Error('old_string and new_string are identical — nothing to change.');
                }
                const operation = this.streamContext?.createOperation({
                    name: 'edit-file', toolName: 'edit_file', plugin: this.name, heartbeatEnabled: false,
                });
                const opId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const vpath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;

                let content: string;
                try {
                    content = await engine.readFile(vpath);
                } catch {
                    throw new Error(`File not found: ${relativePath}`);
                }

                const occurrences = content.split(old_string).length - 1;
                if (occurrences === 0) {
                    throw new Error(
                        `old_string not found in ${relativePath}. It must match the file exactly, including whitespace.`,
                    );
                }
                if (occurrences > 1 && !replace_all) {
                    throw new Error(
                        `old_string appears ${occurrences} times in ${relativePath}. ` +
                        'Add surrounding context to make it unique, or set replace_all: true.',
                    );
                }

                // Literal replacement — a function replacer stops `$&`/`$1` in
                // new_string from being interpreted as regex backreferences.
                const next = replace_all
                    ? content.split(old_string).join(new_string)
                    : content.replace(old_string, () => new_string);
                await engine.writeFile(vpath, next);

                const diff = this.computeDiff(old_string, new_string);
                const replacements = replace_all ? occurrences : 1;
                operation?.complete(`Edited ${relativePath} (+${diff.added.length} -${diff.removed.length})`, {
                    phase: 'complete',
                });
                this.writer?.writeFileOperation(opId, 'edit', relativePath, 'complete', {
                    added: diff.added.length,
                    removed: diff.removed.length,
                    diff: { removed: diff.removed.slice(0, 30), added: diff.added.slice(0, 30) },
                });
                return { success: true, path: relativePath, replacements };
            },
        });
    }

    /** The changed hunk between two strings — lines left after trimming shared prefix/suffix. */
    private computeDiff(oldStr: string, newStr: string): { removed: string[]; added: string[] } {
        const oldLines = oldStr.split('\n');
        const newLines = newStr.split('\n');
        let start = 0;
        while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
        let end = 0;
        while (
            end < oldLines.length - start &&
            end < newLines.length - start &&
            oldLines[oldLines.length - 1 - end] === newLines[newLines.length - 1 - end]
        ) end++;
        return {
            removed: oldLines.slice(start, oldLines.length - end),
            added: newLines.slice(start, newLines.length - end),
        };
    }

    get tools(): Record<string, any> {
        if (!this.bashTool) return {};
        return this.editTool ? { bash: this.bashTool, edit_file: this.editTool } : { bash: this.bashTool };
    }

    modifySystemPrompt(prompt: string): string {
        return `${prompt}

## Bash Shell — your single interface to the workspace
All file work goes through bash(); there is no separate file tool. It's an
in-process bash sandbox (working directory: ${this.baseDir}, persists between calls).

- **Read**: \`cat file\`, \`grep -n pat file\`, \`head\`/\`tail\`, \`sed -n '10,40p' file\`.
- **List / explore**: \`ls -la\`, \`find . -name '*.ts'\`, \`tree\`, \`rg pattern\`.
- **Create / overwrite**: a quoted heredoc keeps content literal —
  \`cat > path/file.ts <<'EOF'\n…contents…\nEOF\`. Use \`tee\` to write + show.
- **Edit existing files**: prefer the \`edit_file\` tool — an exact old→new string
  swap (no regex/escaping, shows a diff). Fall back to \`sed -i 's/old/new/' file\`
  (GNU style) or \`awk\` only for bulk/programmatic transforms.
- **Review changes**: \`diff old new\` (there is no \`patch\` command — edit with sed/awk).

This shell is just-bash with **GNU**-style tools — it is NOT the host OS shell.
Use \`sed -i 's/…/' file\` with NO \`''\` backup suffix: the BSD/macOS form
\`sed -i '' 's/…/' file\` FAILS here (\`''\` is read as the script). Assume GNU
coreutils, not BSD, regardless of what OS you think you're on.

Available: standard shell built-ins plus sed, awk, grep, rg, find, jq, yq, diff,
tar, sqlite3, and more. Host programs — node, git, npm, python — are NOT
available. Be careful with destructive commands.`;
    }
}
