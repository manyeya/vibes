import { tool, type UIMessageStreamWriter } from "ai";
import {
    VibesUIMessage,
    Plugin,
    PluginStreamContext,
    createDataStreamWriter,
    type DataStreamWriter,
} from "../core/types";
import z from "zod";
import { type Sandbox } from "../core/sandbox";
import { LocalSandbox } from "../sandbox/local-sandbox";

/**
 * Constructor options for {@link BashPlugin}.
 *
 * Pass a `sandbox` to route shell execution through any {@link Sandbox}
 * implementation (local, virtual, remote). Pass `baseDir` (or a bare
 * string, kept for backwards compatibility) to spin up a default
 * {@link LocalSandbox} rooted there.
 */
export type BashPluginOptions = string | { sandbox?: Sandbox; baseDir?: string };

/**
 * Plugin that grants the agent access to execute shell commands within a
 * sandbox. Execution is delegated to the {@link Sandbox}, so the plugin
 * itself is free of any runtime-specific (`Bun.*`) shell calls.
 */
export default class BashPlugin implements Plugin {
    name = 'BashPlugin';
    private writer?: DataStreamWriter;
    private streamContext?: PluginStreamContext;
    private sandbox: Sandbox;
    private baseDir: string;

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

    get tools() {
        return {
            bash: tool({
                description: `Execute shell commands within the sandbox.
All commands run from the workspace root: ${this.baseDir}

Common operations:
  ls -la              # List files with details
  find . -name '*.ts' # Find files by pattern
  grep -r 'pattern' . # Search file contents

Use this for advanced exploration, searching, and managing your work.`,
                inputSchema: z.object({
                    command: z.string().describe('The shell command to execute'),
                }),
                execute: async ({ command }) => {
                    const operation = this.streamContext?.createOperation({
                        name: 'bash-command',
                        toolName: 'bash',
                        plugin: this.name,
                        heartbeatMessage: `Shell command is still running in ${this.baseDir}`,
                    });
                    const preview = command.length > 120 ? `${command.slice(0, 117)}...` : command;
                    const cmdId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                    const trunc = (s: string) => (s.length > 600 ? `${s.slice(0, 600)}…` : s);
                    operation?.milestone(`Preparing shell command in ${this.baseDir}`, { phase: 'prepare' });
                    operation?.milestone(`Running command: ${preview}`, { phase: 'execute' });
                    this.writer?.writeCommand(cmdId, command, 'running');

                    const result = await this.sandbox.exec(command);
                    operation?.complete(`Command finished with exit code ${result.exitCode}`, {
                        phase: 'complete',
                    });
                    this.writer?.writeCommand(cmdId, command, 'complete', {
                        exitCode: result.exitCode,
                        stdout: trunc(result.stdout),
                        stderr: trunc(result.stderr),
                    });
                    return {
                        stdout: result.stdout,
                        stderr: result.stderr,
                        exitCode: result.exitCode,
                    };
                },
            }),
        };
    }

    modifySystemPrompt(prompt: string): string {
        return `${prompt}

## Bash Shell Access
You have access to a sandboxed bash-like shell via the bash() tool.
- Your working directory is: ${this.baseDir}
- Use bash() for advanced exploration, searching, and system tasks (ls, grep, find, etc.).
- Be careful with destructive commands.`;
    }
}
