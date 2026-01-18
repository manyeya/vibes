import { LanguageModel, stepCountIs, tool, ToolLoopAgent, UIMessageStreamWriter } from "ai";
import { Middleware } from ".";
import { AgentUIMessage } from '..';
import StateBackend from "../backend/statebackend";
import z from "zod";

/**
 * Configuration for a specialized sub-agent that can be delegated tasks.
 */
export interface SubAgent {
    /** Name used to identify the agent in the delegation tool */
    name: string;
    /** Description of what this agent specializes in */
    description: string;
    /** The core persona and operating rules for the sub-agent */
    systemPrompt: string;
    /** List of tool names to inherit from parent, or direct tool definitions */
    tools?: string[] | Record<string, any>;
    /** Optional specific model to use for this sub-agent */
    model?: LanguageModel;
}

/**
 * Middleware that allows an agent to delegate tasks to specialized sub-agents.
 * Uses the ToolLoopAgent pattern from AI SDK v6 for standardized delegation.
 */
export default class SubAgentMiddleware implements Middleware {
    name = 'SubAgentMiddleware';
    private writer?: UIMessageStreamWriter<AgentUIMessage>;

    constructor(
        private backend: StateBackend,
        private subAgents: Map<string, SubAgent>,
        private baseModel: LanguageModel,
        private getGlobalTools: () => Record<string, any>
    ) { }

    onStreamReady(writer: UIMessageStreamWriter<AgentUIMessage>) {
        this.writer = writer;
    }

    get tools() {
        const taskTool = tool({
            description: `Delegate tasks to specialized sub - agents with isolated context windows.

Available sub - agents: ${Array.from(this.subAgents.keys()).map(name => {
                const agent = this.subAgents.get(name)!;
                return `${name}: ${agent.description}`;
            }).join('\n')
                }

Use sub - agents when:
- Task needs specialized expertise
    - You want to isolate context for a focused task
        - Running multiple research threads in parallel

DO NOT use sub - agents for:
    - Simple, single - step tasks
        - Tasks you can easily do yourself`,
            inputSchema: z.object({
                agent_name: z.string().describe('Name of the sub-agent to use'),
                task: z.string().describe('The task to delegate'),
            }),
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

                // Use standard AI SDK v6 ToolLoopAgent
                const agent = new ToolLoopAgent({
                    model,
                    instructions: subAgentDesc.systemPrompt,
                    tools: agentTools,
                    stopWhen: stepCountIs(5),
                });

                this.writer?.write({
                    type: 'data-status',
                    data: { message: `Delegating task to ${agent_name}...` },
                });

                const result = await agent.generate({
                    prompt: task,
                });

                // Results are saved to the shared filesystem for context offloading
                const resultPath = `/subagent_results/${agent_name}_${Date.now()}.md`;
                await this.backend.writeFile(resultPath, result.text);

                this.writer?.write({
                    type: 'data-status',
                    data: { message: `Task delegated to ${agent_name}` },
                });
                return {
                    result: result.text,
                    savedTo: resultPath,
                };
            },
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

Sub - agents run in isolated contexts and save their results to files.`;
    }
}
