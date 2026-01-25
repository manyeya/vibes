import { type LanguageModel, type UIMessageStreamWriter, tool } from "ai";
import { AgentUIMessage, Middleware, SubAgent } from "../core/types";
import { VibeAgent } from "../core/agent";
import z from "zod";
import * as path from "path";
import * as fs from "fs";

/**
 * Registry entry for tracking delegated tasks
 */
export interface DelegationRegistryEntry {
    /** Timestamp when the task was delegated */
    timestamp: number;
    /** Path to the result file */
    resultPath: string;
    /** Whether the task completed successfully */
    completed: boolean;
    /** The cached result summary */
    summary?: string;
    /** The agent that performed the task */
    agentName: string;
    /** The original task description (truncated) */
    taskSignature: string;
}

/**
 * Registry for tracking delegated tasks to prevent re-delegation
 */
class DelegationRegistry {
    private entries: Map<string, DelegationRegistryEntry> = new Map();
    private defaultTTL: number;

    /**
     * @param defaultTTL - Time-to-live for cache entries in milliseconds (default 1 hour)
     */
    constructor(defaultTTL: number = 60 * 60 * 1000) {
        this.defaultTTL = defaultTTL;
    }

    /**
     * Generate a unique signature for a task
     */
    private generateSignature(agentName: string, task: string): string {
        // Use agent name + first 200 chars of task for uniqueness
        const taskPrefix = task.length > 200 ? task.slice(0, 200) : task;
        return `${agentName}:${taskPrefix}`;
    }

    /**
     * Check if a task has already been delegated and is still valid
     */
    get(agentName: string, task: string, ttl?: number): DelegationRegistryEntry | null {
        const signature = this.generateSignature(agentName, task);
        const entry = this.entries.get(signature);

        if (!entry) {
            return null;
        }

        // Check if entry has expired
        const entryTTL = ttl ?? this.defaultTTL;
        const now = Date.now();
        if (now - entry.timestamp > entryTTL) {
            // Remove expired entry
            this.entries.delete(signature);
            return null;
        }

        return entry;
    }

    /**
     * Register a new delegated task
     */
    set(agentName: string, task: string, resultPath: string, summary: string, completed: boolean = true): DelegationRegistryEntry {
        const signature = this.generateSignature(agentName, task);
        const taskPrefix = task.length > 200 ? task.slice(0, 200) : task;

        const entry: DelegationRegistryEntry = {
            timestamp: Date.now(),
            resultPath,
            completed,
            summary,
            agentName,
            taskSignature: taskPrefix,
        };

        this.entries.set(signature, entry);
        return entry;
    }

    /**
     * Get all entries (for debugging/observability)
     */
    getAllEntries(): DelegationRegistryEntry[] {
        return Array.from(this.entries.values());
    }

    /**
     * Clean up expired entries
     */
    cleanup(ttl?: number): void {
        const now = Date.now();
        const entryTTL = ttl ?? this.defaultTTL;

        for (const [signature, entry] of this.entries.entries()) {
            if (now - entry.timestamp > entryTTL) {
                this.entries.delete(signature);
            }
        }
    }

    /**
     * Clear all entries
     */
    clear(): void {
        this.entries.clear();
    }
}

/**
 * Middleware that allows an agent to delegate tasks to specialized sub-agents.
 * Uses the VibeAgent core for full middleware support in sub-agents.
 */
export default class SubAgentMiddleware implements Middleware {
    name = 'SubAgentMiddleware';
    private writer?: UIMessageStreamWriter<AgentUIMessage>;
    private registry: DelegationRegistry;

    constructor(
        private subAgents: Map<string, SubAgent>,
        private baseModel: LanguageModel,
        private _getGlobalTools: () => Record<string, any>,
        private getGlobalMiddleware: () => Middleware[] = () => [],
        private workspaceDir: string = 'workspace',
        private cacheTTL: number = 60 * 60 * 1000 // Default 1 hour TTL
    ) {
        this.registry = new DelegationRegistry(cacheTTL);
    }

    /**
     * Get the delegation registry (for testing/inspection)
     */
    getRegistry(): DelegationRegistry {
        return this.registry;
    }

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
- Tasks you can easily do yourself

IMPORTANT: If a task was already delegated, you will receive a cached result.`,
            execute: async ({ agent_name, task }) => {
                const subAgentDesc = this.subAgents.get(agent_name);
                if (!subAgentDesc) {
                    throw new Error(`Sub-agent not found: ${agent_name}`);
                }

                // Check if this task was already delegated
                const cachedEntry = this.registry.get(agent_name, task, this.cacheTTL);
                if (cachedEntry) {
                    this.writer?.write({
                        type: 'data-status',
                        data: { message: `[CACHED] Task was already completed by ${agent_name}. Returning cached result from ${new Date(cachedEntry.timestamp).toISOString()}.` },
                    });

                    return {
                        status: "cached",
                        summary: `[CACHED] This task was already delegated to ${agent_name} at ${new Date(cachedEntry.timestamp).toISOString()}. The cached result is being returned instead of re-delegating.`,
                        savedTo: cachedEntry.resultPath,
                        cached: true,
                        originalTimestamp: cachedEntry.timestamp,
                    };
                }

                this.writer?.write({
                    type: 'data-status',
                    data: { message: `Delegating task to ${agent_name} via Vibes core...` },
                });

                try {
                    // Append completion instructions to the task
                    const taskWithSummaryInstructions = `${task}

---

IMPORTANT: When you complete this task, you MUST end your response with a summary block in this exact format:

\`\`\`SUMMARY
Completed: [brief description of what you did]
Files:
- [file path 1]
- [file path 2]
- etc. (list all files you created or modified)
\`\`\`

List ALL files you created using writeFile(). If you didn't create any files, say "Files: none"`;

                    // Create a VibeAgent for the sub-task to support full middleware stack
                const agent = new VibeAgent({
                    model: subAgentDesc.model || this.baseModel,
                    instructions: subAgentDesc.systemPrompt,
                    // Inherit global middleware if none specified for this sub-agent
                    middleware: subAgentDesc.middleware || this.getGlobalMiddleware(),
                    // Custom tool definitions (object format only, string arrays are deprecated)
                    tools: typeof subAgentDesc.tools === 'object' && !Array.isArray(subAgentDesc.tools)
                        ? subAgentDesc.tools as Record<string, any>
                        : undefined,
                    // Whitelist of inherited tools to allow (undefined = all allowed)
                    allowedTools: subAgentDesc.allowedTools,
                    // Blacklist of tool names to block (takes precedence over allowedTools)
                    blockedTools: subAgentDesc.blockedTools,
                });

                // Execute the agent invocation (manages its own tool loop via generateText)
                const result = await agent.generate({
                    messages: [{ role: 'user', content: taskWithSummaryInstructions }]
                });

                // Parse the SUMMARY block from the agent's response
                const summaryMatch = result.text?.match(/```SUMMARY\n([\s\S]+?)```/);
                let agentSummary = '';
                let filesList: string[] = [];

                if (summaryMatch) {
                    const summaryContent = summaryMatch[1];
                    agentSummary = summaryContent.trim();

                    // Extract files from the summary
                    const filesSection = summaryContent.match(/Files:\n([\s\S]+?)(?=\n\n|$)/);
                    if (filesSection) {
                        const filesText = filesSection[1];
                        filesList = filesText
                            .split('\n')
                            .map(line => line.replace(/^[-*]\s*/, '').trim())
                            .filter(line => line && line !== 'none' && !line.startsWith('['));
                    }
                } else {
                    // Fallback: try to extract file paths from the text using regex
                    const filePathRegex = /`([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`/g;
                    const matches = result.text?.matchAll(filePathRegex);
                    if (matches) {
                        filesList = Array.from(matches).map(m => m[1]);
                    }
                    agentSummary = result.text || 'Task completed with no detailed summary.';
                }

                // Build the final result file content
                const resultContent = `# ${agent_name} Task Result

## Task
${task}

## What Was Done
${agentSummary}

## Files Created/Modified
${filesList.length > 0 ? filesList.map(f => `- \`${f}\``).join('\n') : 'No files listed'}
`;

                // Write to subagent_results
                const resultDir = `${this.workspaceDir}/subagent_results`;
                const filename = `${agent_name}_${Date.now()}.md`;
                const relativePath = `subagent_results/${filename}`;
                const fullPath = path.resolve(process.cwd(), this.workspaceDir, relativePath);

                // Ensure directory exists
                await Bun.spawn(["mkdir", "-p", path.resolve(process.cwd(), resultDir)]).exited;

                await Bun.write(fullPath, resultContent);

                if (process.env.DEBUG_VIBES) {
                    console.log(`[SubAgentMiddleware] ${agent_name} completed:`, {
                        textLength: result.text?.length || 0,
                        filesCreated: filesList.length,
                    });
                }

                // Register this task in the delegation registry
                this.registry.set(agent_name, task, relativePath, agentSummary, true);

                this.writer?.write({
                    type: 'data-status',
                    data: { message: `Task completed by ${agent_name}` },
                });

                return {
                    status: "completed",
                    summary: agentSummary,
                    savedTo: relativePath,
                    cached: false,
                    filesCreated: filesList.length > 0 ? filesList : undefined,
                };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    console.error(`[SubAgentMiddleware] Error executing ${agent_name}:`, errorMessage);

                    this.writer?.write({
                        type: 'data-status',
                        data: { message: `Error in ${agent_name}: ${errorMessage}` },
                    });

                    return {
                        status: "error",
                        summary: `Error executing ${agent_name}: ${errorMessage}`,
                        error: errorMessage,
                    };
                }
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

## Sub-Agent Delegation

You can delegate tasks to specialized sub-agents using the task() tool.

Available sub-agents:
${agentList}

### How Sub-Agent Delegation Works

1. When you call task() with an agent_name and task, the sub-agent executes the work
2. The sub-agent saves its complete output to a file on the filesystem
3. The tool returns a file path (savedTo) where you can read the full result
4. **IMPORTANT: The task is COMPLETE after delegation. You do not need to do anything else.**

### CRITICAL - STOP RE-DELEGATING

**READ THIS CAREFULLY:**

When the task() tool returns with a \`savedTo\` file path:
- The sub-agent has **ALREADY COMPLETED** the task
- The result is **COMPLETE AND FINAL**
- Your job is to: (1) Read the file using readFile(), (2) Use the information, (3) Move on

**ABSOLUTELY DO NOT:**
- Re-delegate the SAME task to the SAME sub-agent (it will return a CACHED result)
- Re-delegate the SAME task to a DIFFERENT sub-agent (this is wasteful and redundant)
- Break a completed task into smaller pieces and delegate those pieces
- Attempt to "verify" or "double-check" a sub-agent's work by re-delegating

**THE TASK IS COMPLETE AFTER DELEGATION. READ THE RESULT FILE AND MOVE ON.**

If you receive a \`status: "cached"\` response:
- This means you already delegated this exact task
- The cached result is being returned to prevent redundant work
- Use the cached result - do NOT try to delegate again with different wording

### Result File Access

Sub-agents run in isolated contexts. They save their results to the project filesystem and return a file path.
You MUST use readFile() on the returned path if you need to see their full output.

Example workflow:
1. Call task({ agent_name: "researcher", task: "Find information about X" })
2. Receive response with savedTo: "subagent_results/researcher_1234567890.md"
3. Call readFile("workspace/subagent_results/researcher_1234567890.md")
4. Use the information from the file
5. MOVE ON to your next task - do NOT re-delegate`;
    }
}
