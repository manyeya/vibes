import { type LanguageModel, type UIMessageStreamWriter, tool } from "ai";
import {
    VibesUIMessage,
    Plugin,
    SubAgent,
    createDataStreamWriter,
    type DataStreamWriter,
} from "../core/types";
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

interface CompletionData {
    summary: string;
    files: string[];
}

/**
 * Result from a single parallel delegation
 */
export interface ParallelDelegationResult {
    /** The task description */
    task: string;
    /** The sub-agent name */
    agentName: string;
    /** Whether this task completed successfully */
    success: boolean;
    /** The result data if successful */
    result?: {
        status: string;
        summary: string;
        savedTo: string;
        cached: boolean;
        filesCreated?: string[];
        completionConfirmed: boolean;
    };
    /** Error message if failed */
    error?: string;
}

/**
 * Plugin that allows an agent to delegate tasks to specialized sub-agents.
 * Uses the VibeAgent core for full plugin support in sub-agents.
 */
export default class SubAgentPlugin implements Plugin {
    name = 'SubAgentPlugin';
    private writer?: DataStreamWriter;
    private registry: DelegationRegistry;

    constructor(
        private subAgents: Map<string, SubAgent>,
        private baseModel: LanguageModel,
        private _getGlobalTools: () => Record<string, any>,
        private getGlobalPlugins: () => Plugin[] = () => [],
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

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.writer = createDataStreamWriter(writer);
    }

    get tools() {
        // First, define the task tool (kept for backward compatibility)
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
                    this.writer?.writeStatus(
                        `[CACHED] Task was already completed by ${agent_name}. Returning cached result from ${new Date(cachedEntry.timestamp).toISOString()}.`
                    );

                    return {
                        status: "cached",
                        summary: `[CACHED] This task was already delegated to ${agent_name} at ${new Date(cachedEntry.timestamp).toISOString()}. The cached result is being returned instead of re-delegating.`,
                        savedTo: cachedEntry.resultPath,
                        cached: true,
                        originalTimestamp: cachedEntry.timestamp,
                    };
                }

                this.writer?.writeStatus(
                    `Delegating task to ${agent_name} via Vibes core...`
                );

                try {
                    // Create a dedicated completion tracking tool for this subagent invocation
                    // Using a wrapper object to avoid TypeScript closure type narrowing issues
                    const completionRef = { data: null as CompletionData | null };

                    const completionTool = tool({
                        description: `Call this tool to formally report task completion. This signals that you have finished the assigned task.

IMPORTANT: You MUST call this tool when you are done with your task. This is how you report completion.

After calling this tool, your work is considered complete. Do not continue working or make additional tool calls.`,
                        execute: async ({ summary, files }) => {
                            completionRef.data = {
                                summary: summary || 'Task completed',
                                files: files || []
                            };
                            return {
                                status: 'completed',
                                message: 'Task completion recorded. Your work has been saved.'
                            };
                        },
                        inputSchema: z.object({
                            summary: z.string().describe('A brief description of what you accomplished'),
                            files: z.array(z.string()).optional().describe('List of files you created or modified (if any)')
                        }),
                    });

                    // Create enhanced system prompt with explicit completion instructions
                    const enhancedSystemPrompt = `${subAgentDesc.systemPrompt}

## Task Completion Protocol

You have been assigned a specific task to complete. When you finish your work, you MUST call the \`task_completion\` tool to report your results.

### Required Completion Steps:
1. Complete all assigned work
2. Call the \`task_completion\` tool with a summary of what you did
3. List any files you created or modified in the files parameter

### After Calling task_completion:
- Your task is COMPLETE
- Do NOT make additional tool calls
- Do NOT continue working
- The main agent will receive your completion report

This ensures the main agent knows your work is finished and can move forward.`;

                    // Create a VibeAgent for the sub-task to support full plugin stack
                    // CRITICAL: Always include task_completion in allowedTools
                    const allowedToolsWithCompletion = subAgentDesc.allowedTools
                        ? [...subAgentDesc.allowedTools, 'task_completion']
                        : undefined;

                    const agent = new VibeAgent({
                        model: subAgentDesc.model || this.baseModel,
                        instructions: enhancedSystemPrompt,
                        maxSteps: 30, // Limit subagent steps to prevent infinite loops
                        // Inherit global plugins if none specified for this sub-agent
                        plugins: subAgentDesc.plugins || subAgentDesc.middleware || this.getGlobalPlugins(),
                        // Custom tool definitions (object format only, string arrays are deprecated)
                        tools: (() => {
                            const customTools = typeof subAgentDesc.tools === 'object' && !Array.isArray(subAgentDesc.tools)
                                ? { ...subAgentDesc.tools as Record<string, any> }
                                : {};
                            // Add the completion tool
                            customTools.task_completion = completionTool;
                            return customTools;
                        })(),
                        // Whitelist of inherited tools to allow (undefined = all allowed)
                        // IMPORTANT: task_completion is always included via allowedToolsWithCompletion
                        allowedTools: allowedToolsWithCompletion,
                        // Blacklist of tool names to block (takes precedence over allowedTools)
                        blockedTools: subAgentDesc.blockedTools,
                    });

                    // Execute the agent invocation (manages its own tool loop via generateText)
                    const result = await agent.generate({
                        messages: [{ role: 'user', content: `${task}

When you complete this task, you MUST call the task_completion tool to report your results. This is required for proper completion signaling.` }]
                    });

                // Prioritize completion tool data (explicit completion signal)
                let agentSummary = '';
                let filesList: string[] = [];
                let completionConfirmed = false;

                if (completionRef.data) {
                    // Subagent explicitly called task_completion tool - this is the most reliable signal
                    agentSummary = completionRef.data.summary;
                    filesList = completionRef.data.files;
                    completionConfirmed = true;
                } else {
                    // Fallback: Try to parse SUMMARY block from text (for backward compatibility)
                    const summaryMatch = result.text?.match(/```SUMMARY\n([\s\S]+?)```/);
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
                        // Last resort: try to extract file paths from the text using regex
                        const filePathRegex = /`([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`/g;
                        const matches = result.text?.matchAll(filePathRegex);
                        if (matches) {
                            filesList = Array.from(matches).map(m => m[1]);
                        }
                        agentSummary = result.text || 'Task completed but completion tool was not called. Output summarized from text.';
                    }
                }

                // Build the final result file content
                const resultContent = `# ${agent_name} Task Result

## Task
${task}

## Completion Status
${completionConfirmed ? '✅ **Confirmed** - Subagent explicitly reported completion via task_completion tool' : '⚠️ **Inferred** - Completion detected from text output'}

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
                    console.log(`[SubAgentPlugin] ${agent_name} completed:`, {
                        textLength: result.text?.length || 0,
                        filesCreated: filesList.length,
                        completionConfirmed,
                    });
                }

                // Register this task in the delegation registry
                this.registry.set(agent_name, task, relativePath, agentSummary, true);

                this.writer?.writeStatus(
                    `Task completed by ${agent_name} ${completionConfirmed ? '(confirmed)' : '(inferred)'}`
                );

                return {
                    status: "completed",
                    summary: agentSummary,
                    savedTo: relativePath,
                    cached: false,
                    filesCreated: filesList.length > 0 ? filesList : undefined,
                    completionConfirmed,
                };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    console.error(`[SubAgentPlugin] Error executing ${agent_name}:`, errorMessage);

                    this.writer?.writeStatus(
                        `Error in ${agent_name}: ${errorMessage}`
                    );

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

        // Create the delegate tool (rename for clarity, task is an alias)
        const delegateTool = taskTool;

        // Create the parallel_delegate tool
        const parallelDelegateTool = tool({
            description: `Delegate multiple tasks to sub-agents in PARALLEL.
All tasks execute concurrently, and results are aggregated.

Use this when:
- You have multiple independent tasks that can run simultaneously
- Tasks don't depend on each other's results
- You want to speed up total execution time

Available sub-agents: ${Array.from(this.subAgents.keys()).map(name => {
                const agent = this.subAgents.get(name)!;
                return `${name}: ${agent.description}`;
            }).join('\n')
                }

Example: parallel_delegate({ tasks: [
  { agent_name: "researcher", task: "Find documentation on X" },
  { agent_name: "coder", task: "Review src/auth.ts" }
])`,
            inputSchema: z.object({
                tasks: z.array(z.object({
                    agent_name: z.string().describe('Name of the sub-agent to use'),
                    task: z.string().describe('The task to delegate'),
                })).min(1).max(10).describe('Array of tasks to execute in parallel (max 10)'),
                continueOnError: z.boolean().default(false).describe('Continue executing if one task fails'),
            }),
            execute: async ({ tasks, continueOnError }) => {
                this.writer?.writeStatus(
                    `Delegating ${tasks.length} tasks to run in parallel...`
                );

                // Helper function to execute a single delegation
                const executeOne = async (agentName: string, taskDesc: string): Promise<ParallelDelegationResult> => {
                    const subAgentDesc = this.subAgents.get(agentName);
                    if (!subAgentDesc) {
                        return {
                            task: taskDesc,
                            agentName,
                            success: false,
                            error: `Sub-agent not found: ${agentName}`,
                        };
                    }

                    // Check cache first
                    const cachedEntry = this.registry.get(agentName, taskDesc, this.cacheTTL);
                    if (cachedEntry) {
                        return {
                            task: taskDesc,
                            agentName,
                            success: true,
                            result: {
                                status: 'cached',
                                summary: `[CACHED] ${cachedEntry.summary}`,
                                savedTo: cachedEntry.resultPath,
                                cached: true,
                                completionConfirmed: true,
                            },
                        };
                    }

                    try {
                        // Create completion tracker
                        const completionRef = { data: null as CompletionData | null };

                        const completionTool = tool({
                            description: 'Call this tool to formally report task completion.',
                            execute: async ({ summary, files }) => {
                                completionRef.data = {
                                    summary: summary || 'Task completed',
                                    files: files || []
                                };
                                return {
                                    status: 'completed',
                                    message: 'Task completion recorded.',
                                };
                            },
                            inputSchema: z.object({
                                summary: z.string().describe('Brief description of what you accomplished'),
                                files: z.array(z.string()).optional().describe('Files created or modified'),
                            }),
                        });

                        // Create system prompt
                        const enhancedSystemPrompt = `${subAgentDesc.systemPrompt}

## Task Completion Protocol

You have been assigned a specific task to complete. When you finish your work, you MUST call the \`task_completion\` tool to report your results.

### Required Completion Steps:
1. Complete all assigned work
2. Call the \`task_completion\` tool with a summary of what you did
3. List any files you created or modified in the files parameter

### After Calling task_completion:
- Your task is COMPLETE
- Do NOT make additional tool calls`;

                        // Create agent
                        const allowedToolsWithCompletion = subAgentDesc.allowedTools
                            ? [...subAgentDesc.allowedTools, 'task_completion']
                            : undefined;

                        const agent = new VibeAgent({
                            model: subAgentDesc.model || this.baseModel,
                            instructions: enhancedSystemPrompt,
                            maxSteps: 30,
                            plugins: subAgentDesc.plugins || subAgentDesc.middleware || this.getGlobalPlugins(),
                            tools: (() => {
                                const customTools = typeof subAgentDesc.tools === 'object' && !Array.isArray(subAgentDesc.tools)
                                    ? { ...subAgentDesc.tools as Record<string, any> }
                                    : {};
                                customTools.task_completion = completionTool;
                                return customTools;
                            })(),
                            allowedTools: allowedToolsWithCompletion,
                            blockedTools: subAgentDesc.blockedTools,
                        });

                        // Execute
                        const result = await agent.generate({
                            messages: [{ role: 'user', content: `${taskDesc}

When you complete this task, you MUST call the task_completion tool to report your results.` }]
                        });

                        // Parse completion
                        let agentSummary = '';
                        let filesList: string[] = [];
                        let completionConfirmed = false;

                        if (completionRef.data) {
                            agentSummary = completionRef.data.summary;
                            filesList = completionRef.data.files;
                            completionConfirmed = true;
                        } else {
                            const summaryMatch = result.text?.match(/```SUMMARY\n([\s\S]+?)```/);
                            if (summaryMatch) {
                                agentSummary = summaryMatch[1].trim();
                                const filesSection = agentSummary.match(/Files:\n([\s\S]+?)(?=\n\n|$)/);
                                if (filesSection) {
                                    filesList = filesSection[1]
                                        .split('\n')
                                        .map(line => line.replace(/^[-*]\s*/, '').trim())
                                        .filter(line => line && line !== 'none');
                                }
                            } else {
                                agentSummary = result.text || 'Task completed';
                            }
                        }

                        // Write result file
                        const resultDir = `${this.workspaceDir}/subagent_results`;
                        const filename = `${agentName}_${Date.now()}.md`;
                        const relativePath = `subagent_results/${filename}`;
                        const fullPath = path.resolve(process.cwd(), this.workspaceDir, relativePath);

                        await Bun.spawn(["mkdir", "-p", path.resolve(process.cwd(), resultDir)]).exited;
                        await Bun.write(fullPath, `# ${agentName} Task Result\n\n## Task\n${taskDesc}\n\n## What Was Done\n${agentSummary}\n\n## Files\n${filesList.length > 0 ? filesList.map(f => `- \`${f}\``).join('\n') : 'No files'}`);

                        // Register in cache
                        this.registry.set(agentName, taskDesc, relativePath, agentSummary, true);

                        return {
                            task: taskDesc,
                            agentName,
                            success: true,
                            result: {
                                status: 'completed',
                                summary: agentSummary,
                                savedTo: relativePath,
                                cached: false,
                                filesCreated: filesList.length > 0 ? filesList : undefined,
                                completionConfirmed,
                            },
                        };
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        return {
                            task: taskDesc,
                            agentName,
                            success: false,
                            error: errorMessage,
                        };
                    }
                };

                // Execute all tasks in parallel
                const results = await Promise.all(
                    tasks.map(t => executeOne(t.agent_name, t.task))
                );

                const completedCount = results.filter(r => r.success).length;
                const failedCount = results.length - completedCount;

                // Aggregate summaries
                const summary = `Parallel delegation complete: ${completedCount}/${results.length} tasks succeeded.`;

                this.writer?.writeStatus(summary);

                return {
                    success: failedCount === 0 || continueOnError,
                    total: results.length,
                    completed: completedCount,
                    failed: failedCount,
                    results,
                    summary,
                };
            },
        });

        return {
            task: taskTool,           // Original tool name for backward compatibility
            delegate: delegateTool,   // Alias for clarity
            parallel_delegate: parallelDelegateTool,
        };
    }

    modifySystemPrompt(prompt: string): string {
        const agentList = Array.from(this.subAgents.entries())
            .map(([name, agent]) => `- ${name}: ${agent.description} `)
            .join('\n');

        return `${prompt}

## Sub-Agent Delegation

You can delegate tasks to specialized sub-agents using:
- \`task()\` or \`delegate()\` - Single task delegation
- \`parallel_delegate()\` - Multiple tasks running concurrently

Available sub-agents:
${agentList}

### Single Task Delegation (task / delegate)

For individual tasks, use:
\`\`\`typescript
task({ agent_name: "researcher", task: "Find documentation on X" })
\`\`\`

### Parallel Delegation (parallel_delegate)

For multiple independent tasks, use \`parallel_delegate()\` to run them concurrently:

\`\`\`typescript
parallel_delegate({
  tasks: [
    { agent_name: "researcher", task: "Find documentation on X" },
    { agent_name: "coder", task: "Review src/auth.ts" },
    { agent_name: "tester", task: "Check test coverage" }
  ],
  continueOnError: false  // Set true to continue if one task fails
})
\`\`\`

**Benefits:**
- All tasks execute simultaneously (faster total time)
- Results are aggregated and returned together
- Each task gets its own result file
- Failed tasks don't prevent others from completing (with continueOnError)

**When to use parallel_delegate:**
- Multiple independent research tasks
- Reviewing different files simultaneously
- Gathering information from multiple sources
- Any work that doesn't have dependencies between tasks

**Response structure:**
\`\`\`json
{
  "success": true,
  "total": 3,
  "completed": 3,
  "failed": 0,
  "results": [
    {
      "task": "...",
      "agentName": "researcher",
      "success": true,
      "result": { "status": "completed", "summary": "...", "savedTo": "..." }
    },
    ...
  ]
}
\`\`\`

### How Sub-Agent Delegation Works

1. When you call task() with an agent_name and task, the sub-agent executes the work
2. The sub-agent explicitly reports completion by calling a dedicated task_completion tool
3. The sub-agent saves its complete output to a file on the filesystem
4. The tool returns a response with:
   - \`status: "completed"\` - The task finished successfully
   - \`completionConfirmed: true\` - The subagent explicitly confirmed completion
   - \`savedTo\` - Path to the full result file
   - \`summary\` - Brief description of what was done
   - \`filesCreated\` - List of any files created/modified

### CRITICAL - STOP RE-DELEGATING

**READ THIS CAREFULLY:**

When the task() tool returns with \`status: "completed"\`:
- The sub-agent has **ALREADY COMPLETED** the task
- If \`completionConfirmed: true\`, the subagent explicitly called task_completion
- The result is **COMPLETE AND FINAL**
- Your job is to: (1) Read the result file if needed, (2) Use the information, (3) Move on

**ABSOLUTELY DO NOT:**
- Re-delegate the SAME task to the SAME sub-agent (it will return a CACHED result)
- Re-delegate the SAME task to a DIFFERENT sub-agent (this is wasteful and redundant)
- Break a completed task into smaller pieces and delegate those pieces
- Attempt to "verify" or "double-check" a sub-agent's work by re-delegating
- Continue delegating related work to the same subagent after completion

**THE TASK IS COMPLETE AFTER DELEGATION. READ THE RESULT FILE AND MOVE ON.**

### Completion Signals You Will See

A successful task delegation returns:
\`\`\`json
{
  "status": "completed",
  "completionConfirmed": true,
  "summary": "Brief description of what was accomplished",
  "savedTo": "subagent_results/agent_name_1234567890.md",
  "filesCreated": ["path/to/file1.ext", "path/to/file2.ext"]
}
\`\`\`

When you see this, the work is DONE. Proceed to your next task.

### Cached Responses

If you receive \`status: "cached"\`:
- This means you already delegated this exact task
- The cached result is being returned to prevent redundant work
- Use the cached result - do NOT try to delegate again with different wording

### Result File Access

Sub-agents run in isolated contexts. They save their results to the project filesystem and return a file path.
Use readFile() on the returned path if you need to see their full output.

Example workflow:
1. Call task({ agent_name: "Explorer", task: "Find the authentication logic" })
2. Receive response with status: "completed", completionConfirmed: true, savedTo: "..."
3. (Optional) Call readFile("workspace/subagent_results/Explorer_1234567890.md") for details
4. Use the information from the file
5. MOVE ON to your next task - do NOT re-delegate`;
    }
}
