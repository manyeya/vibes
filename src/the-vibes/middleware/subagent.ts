import { type LanguageModel, type UIMessageStreamWriter, type Tool, tool } from "ai";
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

                // Resolve tools for sub-agent
                let agentTools: Record<string, any> = {};
                if (Array.isArray(subAgentDesc.tools)) {
                    const allTools = this.getGlobalTools();
                    for (const toolName of subAgentDesc.tools) {
                        if (allTools[toolName]) {
                            agentTools[toolName] = allTools[toolName];
                        }
                    }
                } else if (subAgentDesc.tools) {
                    agentTools = subAgentDesc.tools;
                }

                const model = subAgentDesc.model || this.baseModel;

                // Instantiate custom VibeAgent instead of standard ToolLoopAgent
                const agent = new VibeAgent({
                    model,
                    instructions: subAgentDesc.systemPrompt,
                    tools: agentTools,
                    maxSteps: 10,
                    workspaceDir: this.workspaceDir,
                });

                // Add shared middleware (e.g. SkillsMiddleware)
                const sharedMiddleware = this.getGlobalMiddleware().filter(mw =>
                    mw.name === 'SkillsMiddleware' ||
                    mw.name === 'MemoryMiddleware' ||
                    subAgentDesc.middleware?.some(sm => sm.name === mw.name)
                );
                agent.addMiddleware(sharedMiddleware);

                this.writer?.write({
                    type: 'data-status',
                    data: { message: `Delegating task to ${agent_name}...` },
                });

                // Execute the agent invocation
                const result = await agent.invoke({
                    messages: [{ role: 'user', content: task }]
                });

                // Results are saved to the shared filesystem for context offloading
                const resultDir = `${this.workspaceDir}/subagent_results`;
                const filename = `${agent_name}_${Date.now()}.md`;
                const relativePath = `subagent_results/${filename}`;
                const fullPath = path.resolve(process.cwd(), this.workspaceDir, relativePath);

                // Ensure directory exists using Bun native spawn (avoiding node:fs)
                await Bun.spawn(["mkdir", "-p", path.resolve(process.cwd(), resultDir)]).exited;
                await Bun.write(fullPath, result.text);

                this.writer?.write({
                    type: 'data-status',
                    data: { message: `Task completed by ${agent_name}` },
                });

                return {
                    status: "completed",
                    summary: `Task completed by ${agent_name}. Results saved to file. Read this file if you need the full details.`,
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
