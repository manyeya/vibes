import { tool, type UIMessageStreamWriter } from "ai";
import { AgentUIMessage, Middleware } from "../core/types";
import z from "zod";
import { $ } from "bun";
import * as path from "node:path";

/**
 * Middleware that grants the agent access to execute shell commands
 * on the host system within a specific directory.
 */
export default class BashMiddleware implements Middleware {
    name = 'BashMiddleware';
    private writer?: UIMessageStreamWriter<AgentUIMessage>;
    private baseDir: string;

    constructor(baseDir: string = 'workspace') {
        this.baseDir = path.resolve(process.cwd(), baseDir);
    }

    onStreamReady(writer: UIMessageStreamWriter<AgentUIMessage>) {
        this.writer = writer;
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
                    this.writer?.write({
                        type: 'data-status',
                        data: { message: `Running command: ${command}...` },
                    });

                    try {
                        const result = await $`${{ raw: command }}`.cwd(this.baseDir).quiet();
                        return {
                            stdout: result.stdout.toString(),
                            stderr: result.stderr.toString(),
                            exitCode: result.exitCode,
                        };
                    } catch (error: any) {
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
