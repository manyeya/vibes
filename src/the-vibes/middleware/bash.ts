import { tool, UIMessageStreamWriter } from "ai";
import { Middleware } from ".";
import { AgentUIMessage } from "../../deep-agent";
import { Bash, ReadWriteFs } from 'just-bash';
import { createBashTool } from 'bash-tool';

/**
 * Middleware that grants the agent direct access to the host's
 * real filesystem and a bash execution environment.
 */
export default class BashMiddleware implements Middleware {
    name = 'BashMiddleware';
    private bashTools: any = null;
    private initializationPromise: Promise<void>;
    private writer?: UIMessageStreamWriter<AgentUIMessage>;

    constructor() {
        this.initializationPromise = this.init();
    }

    onStreamReady(writer: UIMessageStreamWriter<AgentUIMessage>) {
        this.writer = writer;
    }

    private async init() {
        const root = process.cwd();
        const bashEnv = new Bash({
            fs: new ReadWriteFs({ root }),
            cwd: '/',
        });

        const { tools } = await createBashTool({
            sandbox: bashEnv,
        });

        this.bashTools = tools;
    }

    async waitReady() {
        await this.initializationPromise;
    }

    get tools() {
        if (!this.bashTools) return {};

        // Wrap bash tools to provide status updates
        const wrappedTools: Record<string, any> = {};
        for (const [name, originalTool] of Object.entries(this.bashTools)) {
            wrappedTools[name] = tool({
                ...originalTool as any,
                execute: async (args: any) => {
                    this.writer?.write({
                        type: 'data-status',
                        data: { message: `Running ${name}...` },
                    });
                    return (originalTool as any).execute(args);
                }
            });
        }
        return wrappedTools;
    }

    modifySystemPrompt(prompt: string): string {
        return `${prompt}

## Filesystem & Bash Access
You have access to the real project filesystem and a bash-like environment.
- Use bash() to execute shell commands (ls, grep, find, etc.)
- Use readFile() to read file contents
- Use writeFile() to create or overwrite files
- Operations are relative to the project root.
- ALWAYS check if a file exists before reading it if you are unsure.`;
    }
}