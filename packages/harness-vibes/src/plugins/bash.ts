import { tool, type UIMessageStreamWriter } from "ai";
import {
    VibesUIMessage,
    Plugin,
    PluginStreamContext,
    createDataStreamWriter,
    type DataStreamWriter,
} from "../core/types";
import z from "zod";
import { $ } from "bun";
import * as path from "path";

/**
 * Plugin that grants the agent access to execute shell commands
 * on the host system within a specific directory.
 */
export default class BashPlugin implements Plugin {
    name = 'BashPlugin';
    private writer?: DataStreamWriter;
    private streamContext?: PluginStreamContext;
    private baseDir: string;

    constructor(baseDir: string = 'workspace') {
        this.baseDir = path.resolve(process.cwd(), baseDir);
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
                description: `Execute shell commands directly on the host system.
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
                    operation?.milestone(`Preparing shell command in ${this.baseDir}`, { phase: 'prepare' });
                    operation?.milestone(`Running command: ${preview}`, { phase: 'execute' });

                    try {
                        const result = await $`${{ raw: command }}`.cwd(this.baseDir).quiet();
                        operation?.complete(`Command finished with exit code ${result.exitCode}`, {
                            phase: 'complete',
                        });
                        return {
                            stdout: result.stdout.toString(),
                            stderr: result.stderr.toString(),
                            exitCode: result.exitCode,
                        };
                    } catch (error: any) {
                        operation?.complete(`Command finished with exit code ${error.exitCode ?? 1}`, {
                            phase: 'complete',
                        });
                        return {
                            stdout: error.stdout?.toString() || '',
                            stderr: error.stderr?.toString() || error.message,
                            exitCode: error.exitCode ?? 1,
                        };
                    }
                },
            }),
        };
    }

    modifySystemPrompt(prompt: string): string {
        return `${prompt}

## Bash Shell Access
You have direct access to a bash-like shell via the bash() tool.
- Your working directory is: ${this.baseDir}
- Use bash() for advanced exploration, searching, and system tasks (ls, grep, find, etc.).
- Be careful with destructive commands.`;
    }
}
