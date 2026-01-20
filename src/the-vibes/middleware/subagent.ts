import { type LanguageModel, type UIMessageStreamWriter, type Tool, tool, Agent, ToolLoopAgent, stepCountIs } from "ai";
import { AgentUIMessage, Middleware, SubAgent } from "../core/types";
import { VibeAgent } from "../core/agent";
import z from "zod";
import * as path from "node:path";

/**
 * Middleware that allows an agent to delegate tasks to specialized sub-agents.
 * Uses the VibeAgent core for full middleware support in sub-agents.
 */
export default class SubAgentMiddleware implements Middleware {
    name = 'SubAgentMiddleware';
    private writer?: UIMessageStreamWriter<AgentUIMessage>;

    constructor(
        private subAgents: Map<string, SubAgent>,
        private baseModel: LanguageModel,
        private getGlobalTools: () => Record<string, any>,
        private getGlobalMiddleware: () => Middleware[] = () => [],
        private workspaceDir: string = 'workspace'
    ) { }

    onStreamReady(writer: UIMessageStreamWriter<AgentUIMessage>) {
        this.writer = writer;
    }

    get tools() {
        const taskTool = tool({
            description: `Delegate tasks to specialized sub-agents with isolated context windows.

Available sub-agents: ${Array.from(this.subAgents.keys()).map(name => {
                const agent = this.subAgents.get(name)!;
                return `${name}: ${agent.description}`;
            }).join('\n')
                }

Use sub-agents when:
- Task needs specialized expertise
- You want to isolate context for a focused task
- Running multiple research threads in parallel

DO NOT use sub-agents for:
- Simple, single-step tasks
- Tasks you can easily do yourself`,
            execute: async ({ agent_name, task }) => {
                const subAgentDesc = this.subAgents.get(agent_name);
                if (!subAgentDesc) {
                    throw new Error(`Sub-agent not found: ${agent_name}`);
                }

                this.writer?.write({
                    type: 'data-status',
                    data: { message: `Delegating task to ${agent_name} via Vibes core...` },
                });

                // Create a VibeAgent for the sub-task to support full middleware stack
                const agent = new VibeAgent({
                    model: subAgentDesc.model || this.baseModel,
                    instructions: subAgentDesc.systemPrompt,
                    // Inherit global middleware if none specified for this sub-agent
                    middleware: subAgentDesc.middleware || this.getGlobalMiddleware(),
                    // Pass allowed tool names or custom tool definitions
                    allowedTools: Array.isArray(subAgentDesc.tools) ? subAgentDesc.tools : undefined,
                    tools: !Array.isArray(subAgentDesc.tools) ? subAgentDesc.tools as Record<string, any> : undefined,
                });

                // Execute the agent invocation (manages its own tool loop via generateText)
                const result = await agent.generate({
                    messages: [{ role: 'user', content: task }]
                });

                // Results are saved to the shared filesystem for context offloading
                const resultDir = `${this.workspaceDir}/subagent_results`;
                const filename = `${agent_name}_${Date.now()}.md`;
                const relativePath = `subagent_results/${filename}`;
                const fullPath = path.resolve(process.cwd(), this.workspaceDir, relativePath);

                // Ensure directory exists
                await Bun.spawn(["mkdir", "-p", path.resolve(process.cwd(), resultDir)]).exited;
                await Bun.write(fullPath, result.text);

                this.writer?.write({
                    type: 'data-status',
                    data: { message: `Task completed by ${agent_name}` },
                });

                return {
                    status: "completed",
                    summary: `Task completed by ${agent_name}. Results saved to file.`,
                    savedTo: relativePath,
                };
            },
            inputSchema: z.object({
                agent_name: z.string().describe('Name of the sub-agent to use'),
                task: z.string().describe('The task to delegate'),
            }),
        });

        return { task: taskTool };
    }

    modifySystemPrompt(prompt: string): string {
        const agentList = Array.from(this.subAgents.entries())
            .map(([name, agent]) => `- ${name}: ${agent.description} `)
            .join('\n');

        return `${prompt}

## Sub - Agent Delegation
You can delegate tasks to specialized sub - agents using the task() tool.

Available sub - agents:
${agentList}

Sub - agents run in isolated contexts. They save their results to the project filesystem and return a file path. You MUST use readFile() on the returned path if you need to see their full output.`;
    }
}
