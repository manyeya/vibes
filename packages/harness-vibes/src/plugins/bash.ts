import { tool } from "ai";
import z from "zod";
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
 * Pass a `sandbox` to run the shell at any {@link Sandbox}'s workspace
 * directory. Pass `baseDir` (or a bare string, kept for backwards
 * compatibility) to root it at a path directly.
 */
export type BashPluginOptions = string | { sandbox?: Sandbox; baseDir?: string };

/**
 * Grants the agent a `bash` tool backed by the {@link Sandbox}'s `exec` — a
 * REAL host shell (Bun's `$`), not an in-process interpreter. Host binaries
 * (git, node, npm, python, …) are available, so the agent can actually build,
 * test and run code. The shell's cwd is the workspace root; commands are NOT
 * jailed to it (a real shell is the point).
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

    constructor(options: BashPluginOptions = 'workspace') {
        if (typeof options === 'string') {
            this.sandbox = new LocalSandbox(options);
        } else if (options.sandbox) {
            this.sandbox = options.sandbox;
        } else {
            this.sandbox = new LocalSandbox(options.baseDir ?? 'workspace');
        }
    }

    onStreamContextReady(context: PluginStreamContext) {
        this.streamContext = context;
        this.writer = context.writer.withDefaults({ plugin: this.name });
    }

    get tools(): Record<string, import("ai").Tool> {
        return {
            bash: tool({
                description:
                    'Run a shell command in the workspace via a real host shell. ' +
                    'Host binaries (git, node, npm, python, …) are available. Chain ' +
                    'with pipes, redirects, globs and &&. Use it to explore, search, ' +
                    'build, test and run code — not to read/write file content (use ' +
                    'the file tools for that).',
                inputSchema: z.object({
                    command: z.string().describe('The shell command to run'),
                }),
                execute: async ({ command }) => {
                    const operation = this.streamContext?.createOperation({
                        name: 'bash-command',
                        toolName: 'bash',
                        plugin: this.name,
                    });
                    const preview = command.length > 120 ? `${command.slice(0, 117)}...` : command;
                    const cmdId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                    const trunc = (s: string) => (s.length > 600 ? `${s.slice(0, 600)}…` : s);

                    operation?.milestone(`Running command: ${preview}`, { phase: 'execute' });
                    this.writer?.writeCommand(cmdId, command, 'running');

                    const res = await this.sandbox.exec(command);

                    operation?.complete(`Command finished with exit code ${res.exitCode}`, { phase: 'complete' });
                    this.writer?.writeCommand(cmdId, command, 'complete', {
                        exitCode: res.exitCode,
                        stdout: trunc(res.stdout),
                        stderr: trunc(res.stderr),
                    });
                    return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
                },
            }),
        };
    }

    modifySystemPrompt(prompt: string): string {
        return `${prompt}

## Bash
You have a \`bash\` tool: a real host shell whose working directory is the root
of your workspace (\`${this.sandbox.root}\`). Refer to files by paths relative to
that root — \`ls\`, \`cat README.md\`, \`grep -r foo src\`, \`find . -name '*.ts'\` —
or by absolute host paths.

Host binaries are available: use \`git\`, \`node\`, \`npm\`/\`bun\`, \`python\`, etc. to
build, test and run code. Chain commands with pipes, redirects and globs.`;
    }
}
