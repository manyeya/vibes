import {
    tool,
    type UIMessageStreamWriter,
    type LanguageModel,
    generateText,
} from 'ai';
import { z } from 'zod';
import TasksPlugin from './tasks';
import {
    VibesUIMessage,
    TaskItem,
    Plugin,
    PluginStreamContext,
    TaskType,
    createDataStreamWriter,
    type DataStreamWriter,
    type ModelMessage,
} from '../core/types';

/**
 * Planning configuration options
 */
export interface PlanningConfig {
    /** Path to save/load plan files (default: workspace/plan.md) */
    planPath?: string;
    /** Interval for automatic plan recitation (default: every prepareCall) */
    recitationInterval?: number;
    /** Maximum number of pending tasks to show in recitation */
    maxRecitationTasks?: number;
}

/**
 * Plan entry for hierarchical task structure
 */
export interface PlanEntry {
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'blocked';
    priority: 'low' | 'medium' | 'high' | 'critical';
    parentTaskId?: string;
    subtasks: PlanEntry[];
    blockedBy: string[];
    blocks: string[];
}

/**
 * High-level project plan
 */
export interface Plan {
    id: string;
    title: string;
    createdAt: string;
    problem: string;
    solution: string;
    requirements?: string[];
    phases: Array<{ name: string; goal: string; steps?: string[] }>;
    milestones: string[];
    risks: string[];
}

/**
 * Plan data returned by LLM
 */
interface PlanLLMOutput {
    title: string;
    problem: string;
    solution: string;
    requirements: string[];
    phases: Array<{ name: string; goal: string; steps?: string[] }>;
    milestones: string[];
    risks: string[];
}

/**
 * PlanningPlugin composes TasksPlugin with deep agent planning features:
 * - Task recitation: Always-in-view current plan for attention manipulation
 * - Plan persistence: Save/load plans from filesystem
 * - Hierarchical decomposition: Parent-child task relationships
 * - Smart recitation: Format plan for readability and focus
 */
export class PlanningPlugin implements Plugin {
    name = 'PlanningPlugin';
    private writer?: DataStreamWriter;
    private streamContext?: PluginStreamContext;
    private planPath: string;
    private maxRecitationTasks: number;
    private lastRecitedTasks: TaskItem[] = [];
    private currentPlan?: Plan;
    private model?: LanguageModel;

    // Compose TasksPlugin instead of extending to avoid type conflicts
    private tasksPlugin: TasksPlugin;

    constructor(
        model?: LanguageModel,
        config: PlanningConfig = {}
    ) {
        this.model = model;
        // TasksPlugin uses its own path (workspace/tasks.json), separate from plan.md
        this.tasksPlugin = new TasksPlugin(model, {});
        this.planPath = config.planPath || 'workspace/plan.md';
        this.maxRecitationTasks = config.maxRecitationTasks || 10;
    }

    async waitReady(): Promise<void> {
        await this.tasksPlugin.waitReady();
    }

    onStreamContextReady(context: PluginStreamContext) {
        this.streamContext = context;
        this.writer = context.writer.withDefaults({ plugin: this.name });
        this.tasksPlugin.onStreamContextReady?.(context);
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.streamContext = undefined;
        this.writer = createDataStreamWriter(writer).withDefaults({ plugin: this.name });
        // Also forward to tasks plugin
        this.tasksPlugin.onStreamReady(writer);
    }

    private createOperation(name: string, toolName: string) {
        return this.streamContext?.createOperation({
            name,
            toolName,
            plugin: this.name,
            heartbeatMessage: `${toolName} is still working`,
        });
    }

    /**
     * Modify system prompt to inject task recitation.
     */
    modifySystemPrompt(prompt: string): string | Promise<string> {
        const basePrompt = this.tasksPlugin.modifySystemPrompt(prompt);
        const planningInstructions = `

## Planning & Task Management

**Planning Workflow:**
1. Use \`create_plan()\` to generate a high-level project brief
2. Use \`generate_tasks_from_plan()\` to create specific tasks from the plan
3. Work through tasks sequentially, marking them complete as you go

**Available Tools:**
- \`create_plan(request)\` - Generate a high-level project plan (problem, solution, phases, milestones)
- \`generate_tasks_from_plan()\` - Create specific actionable tasks from the current plan
- \`save_plan()\` - Save the current task plan to a file
- \`load_plan()\` - Load a task plan from a file
- \`recite_plan()\` - Refresh and view your current task plan
- \`create_subtask()\` - Create a subtask under an existing parent task

**Task-Plan Linking:**
Tasks generated from a plan include metadata.planId and metadata.planReference.
This lets you trace each task back to the specific part of the plan it relates to.

Remember: Focus on the current task. Mark it complete before moving to the next.
`;
        if (typeof basePrompt === 'string') {
            return basePrompt + planningInstructions;
        }
        return basePrompt.then(p => p + planningInstructions);
    }

    /**
     * Hook before each step to refresh task cache for recitation.
     */
    async prepareStep(_options: {
        steps: any[];
        stepNumber: number;
        model: LanguageModel;
        messages: ModelMessage[];
        experimental_context?: unknown;
    }): Promise<void> {
        await this.refreshRecitationCache();
    }

    /**
     * Refresh the cached task list for recitation.
     */
    private async refreshRecitationCache(): Promise<void> {
        const allTasks = await this.tasksPlugin.getTasks();
        const pendingTasks = allTasks.filter((t: TaskItem) => t.status !== 'completed' && t.status !== 'failed');

        const statusOrder: Record<string, number> = {
            'in_progress': 0,
            'pending': 1,
            'blocked': 2,
            'failed': 3,
            'completed': 4
        };
        pendingTasks.sort((a: TaskItem, b: TaskItem) => {
            const aOrder = statusOrder[a.status] ?? 3;
            const bOrder = statusOrder[b.status] ?? 3;
            return aOrder - bOrder;
        });

        this.lastRecitedTasks = pendingTasks.slice(0, this.maxRecitationTasks);
    }

    /**
     * Format tasks for recitation in system prompt.
     */
    private formatPlanForRecitation(tasks: TaskItem[]): string {
        let output = `## Current Plan (${tasks.length} active tasks)\n\n`;

        const inProgress = tasks.filter(t => t.status === 'in_progress');
        const pending = tasks.filter(t => t.status === 'pending');
        const blocked = tasks.filter(t => t.status === 'blocked');

        if (inProgress.length > 0) {
            output += `### 🔵 Working On Now\n`;
            for (const task of inProgress) {
                output += this.formatTaskEntry(task);
            }
            output += '\n';
        }

        if (pending.length > 0) {
            output += `### 📋 Next Up\n`;
            for (const task of pending) {
                output += this.formatTaskEntry(task);
            }
            output += '\n';
        }

        if (blocked.length > 0) {
            output += `### ⏸️ Blocked (waiting for dependencies)\n`;
            for (const task of blocked) {
                output += this.formatTaskEntry(task);
            }
            output += '\n';
        }

        output += `---\n**Remember**: Focus on the current task. When complete, mark it done and move to the next. Use \`update_task\` to track progress.`;

        return output;
    }

    private formatTaskEntry(task: TaskItem): string {
        const priorityIcon = {
            'critical': '🔴',
            'high': '🟠',
            'medium': '🟡',
            'low': '⚪'
        }[task.priority] || '⚪';

        const statusPrefix: Record<string, string> = {
            'in_progress': '→',
            'pending': '○',
            'blocked': '⊘',
            'completed': '✓',
            'failed': '✗'
        };
        const prefix = statusPrefix[task.status] || '○';

        let entry = `${prefix} **${task.title}** ${priorityIcon}\n`;

        if (task.description) {
            const desc = task.description.length > 100
                ? task.description.slice(0, 100) + '...'
                : task.description;
            entry += `  ${desc}\n`;
        }

        if (task.blockedBy && task.blockedBy.length > 0) {
            entry += `  ⏳ Blocked by: ${task.blockedBy.join(', ')}\n`;
        }

        return entry + '\n';
    }

    /**
     * Format a plan as markdown for saving to plan.md
     */
    private formatPlanAsMarkdown(plan: Plan): string {
        let content = `# Project Plan: ${plan.title}\n\n`;
        content += `**Plan ID**: \`${plan.id}\`\n`;
        content += `**Created**: ${plan.createdAt}\n\n`;

        content += `## Problem Statement\n\n${plan.problem}\n\n`;

        content += `## Proposed Solution\n\n${plan.solution}\n\n`;

        if (plan.requirements && plan.requirements.length > 0) {
            content += `## Requirements\n\n`;
            for (const req of plan.requirements) {
                content += `- ${req}\n`;
            }
            content += `\n`;
        }

        if (plan.phases.length > 0) {
            content += `## Phases\n\n`;
            for (let i = 0; i < plan.phases.length; i++) {
                const phase = plan.phases[i];
                content += `${i + 1}. **${phase.name}** - ${phase.goal}\n`;
                if (phase.steps && phase.steps.length > 0) {
                    for (const step of phase.steps) {
                        content += `   - ${step}\n`;
                    }
                }
            }
            content += `\n`;
        }

        if (plan.milestones.length > 0) {
            content += `## Milestones\n\n`;
            for (const milestone of plan.milestones) {
                content += `- [ ] ${milestone}\n`;
            }
            content += `\n`;
        }

        if (plan.risks.length > 0) {
            content += `## Risks & Considerations\n\n`;
            for (const risk of plan.risks) {
                content += `- ${risk}\n`;
            }
            content += `\n`;
        }

        return content;
    }

    /**
     * Save a plan to plan.md
     */
    private async savePlanToFile(plan: Plan, path?: string): Promise<void> {
        const savePath = path || this.planPath;
        const content = this.formatPlanAsMarkdown(plan);

        const fullPath = require('path').resolve(process.cwd(), savePath);
        Bun.spawnSync(['mkdir', '-p', require('path').dirname(fullPath)]);
        await Bun.write(fullPath, content);
    }

    /**
     * Load plan from plan.md
     */
    private async loadPlanFromFile(path?: string): Promise<Plan | null> {
        const loadPath = path || this.planPath;
        const fullPath = require('path').resolve(process.cwd(), loadPath);

        try {
            const content = await Bun.file(fullPath).text();
            return this.parsePlanFromMarkdown(content);
        } catch {
            return null;
        }
    }

    /**
     * Parse plan from markdown content
     */
    private parsePlanFromMarkdown(content: string): Plan | null {
        // Extract Plan ID from frontmatter-like line
        const planIdMatch = content.match(/\*\*Plan ID\*\*:\s*`([^`]+)`/);
        const planId = planIdMatch ? planIdMatch[1] : `plan_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

        // Extract title
        const titleMatch = content.match(/^# Project Plan:\s*(.+)$/m);
        const title = titleMatch ? titleMatch[1] : 'Untitled Plan';

        // Extract created date
        const createdMatch = content.match(/\*\*Created\*\*:\s*([^\n]+)/);
        const createdAt = createdMatch ? createdMatch[1].trim() : new Date().toISOString();

        // Extract sections
        const problemMatch = content.match(/## Problem Statement\n\n([\s\S]+?)(?=\n##|$)/);
        const problem = problemMatch ? problemMatch[1].trim() : '';

        const solutionMatch = content.match(/## Proposed Solution\n\n([\s\S]+?)(?=\n##|$)/);
        const solution = solutionMatch ? solutionMatch[1].trim() : '';

        // Extract requirements
        const requirements: string[] = [];
        const requirementsMatch = content.match(/## Requirements\n\n([\s\S]+?)(?=\n##|$)/);
        if (requirementsMatch) {
            const reqLines = requirementsMatch[1].trim().split('\n');
            for (const line of reqLines) {
                const reqMatch = line.match(/^-\s*(.+)$/);
                if (reqMatch) {
                    requirements.push(reqMatch[1].trim());
                }
            }
        }

        // Extract phases
        const phases: Array<{ name: string; goal: string; steps?: string[] }> = [];
        const phasesMatch = content.match(/## Phases\n\n([\s\S]+?)(?=\n##|$)/);
        if (phasesMatch) {
            const lines = phasesMatch[1].trim().split('\n');
            let currentPhase: { name: string; goal: string; steps: string[] } | null = null;

            for (const line of lines) {
                const phaseMatch = line.match(/^\d+\.\s*\*\*([^*]+)\*\*\s*-\s*(.+)$/);
                if (phaseMatch) {
                    if (currentPhase) phases.push(currentPhase);
                    currentPhase = {
                        name: phaseMatch[1].trim(),
                        goal: phaseMatch[2].trim(),
                        steps: []
                    };
                } else {
                    const stepMatch = line.match(/^\s*-\s*(.+)$/);
                    if (stepMatch && currentPhase) {
                        currentPhase.steps.push(stepMatch[1].trim());
                    }
                }
            }
            if (currentPhase) phases.push(currentPhase);
        }

        // Extract milestones
        const milestones: string[] = [];
        const milestonesMatch = content.match(/## Milestones\n\n([\s\S]+?)(?=\n##|$)/);
        if (milestonesMatch) {
            const milestoneLines = milestonesMatch[1].trim().split('\n');
            for (const line of milestoneLines) {
                const milestoneMatch = line.match(/^-\s*\[\]\s*(.+)$/);
                if (milestoneMatch) {
                    milestones.push(milestoneMatch[1].trim());
                }
            }
        }

        // Extract risks
        const risks: string[] = [];
        const risksMatch = content.match(/## Risks & Considerations\n\n([\s\S]+?)(?=$)/);
        if (risksMatch) {
            const riskLines = risksMatch[1].trim().split('\n');
            for (const line of riskLines) {
                const riskMatch = line.match(/^-\s*(.+)$/);
                if (riskMatch) {
                    risks.push(riskMatch[1].trim());
                }
            }
        }

        return {
            id: planId,
            title,
            createdAt,
            problem,
            solution,
            requirements,
            phases,
            milestones,
            risks,
        };
    }

    get tools(): any {
        const baseTools = this.tasksPlugin.tools;

        return Object.assign({}, baseTools, {

            create_plan: tool({
                description: `Create a high-level project plan with problem statement, solution approach, phases, and milestones.`,
                inputSchema: z.object({
                    request: z.string().describe('The user request to create a plan for'),
                }),
                execute: async ({ request }) => {
                    if (!this.model) {
                        this.writer?.writeError('No model available for plan generation', {
                            toolName: 'create_plan',
                            recoverable: true,
                        });
                        return {
                            success: false,
                            error: 'No model available for plan generation',
                        };
                    }

                    const operation = this.createOperation('create-plan', 'create_plan');
                    operation?.milestone('Preparing plan generation context', { phase: 'prepare' });

                    operation?.milestone('Calling language model to generate project plan', { phase: 'model' });
                    const { text } = await generateText({
                        model: this.model,
                        system: `You are an expert Project Architect and Lead Planner. Your goal is to create a COMPREHENSIVE, SOLID, and HIGHLY DETAILED project plan.
No matter how simple the request, you must provide a "professional grade" plan that covers all bases.

### Rarity & Rigor
- If it's Software Development: Consider PRD requirements, Design System tokens/components, Technical Architecture (patterns, states, APIs), Testing, and Deployment.
- If it's Content/Design: Consider Style Guides, Audience Personas, Distribution channels, and Quality benchmarks.
- If it's Research: Consider Methodology, Data Sources, Validation checks, and Reporting structures.

### Plan Sections Required:
1. **Problem Statement**: Deep analysis of context, constraints, and success criteria.
2. **Proposed Solution**: Architectural overview, design patterns, and core logic.
3. **Detailed Requirements**: A list of specific functional and non-functional requirements.
4. **Implementation Phases**: 3-6 phases. Each phase MUST have:
   - A name and a high-level goal.
   - A list of **specific steps** or sub-tasks that will turn that goal into reality.
5. **Measurable Milestones**: Concrete deliverables with clear criteria.
6. **Detailed Risk Analysis**: Identify technical/domain risks and provide specific mitigations.

Output ONLY valid JSON matching this schema:
{
  "title": "Professional Project Title",
  "problem": "Comprehensive multi-paragraph problem analysis...",
  "solution": "Detailed architectural solution describing the 'how'...",
  "requirements": ["Requirement 1", "Requirement 2", ...],
  "phases": [
    {
      "name": "Phase Name", 
      "goal": "Broad objective",
      "steps": ["Detailed sub-step 1", "Detailed sub-step 2", ...]
    }
  ],
  "milestones": ["Deliverable/Checkpoint 1", ...],
  "risks": ["Risk description with mitigation strategy", ...]
}

NEVER be concise. Be exhaustive. Break every objective down into its smallest actionable components.`,
                        prompt: `Create a project plan for:\n\n${request}`,
                    });

                    // Parse JSON response
                    let planData: PlanLLMOutput;
                    try {
                        const jsonMatch = text.match(/```json\s*(\{[\s\S]*\})\s*```/) ||
                            text.match(/```\s*(\{[\s\S]*\})\s*```/) ||
                            text.match(/(\{[\s\S]*\})/);
                        if (!jsonMatch) {
                            throw new Error('No JSON found in response');
                        }
                        planData = JSON.parse(jsonMatch[1]);
                    } catch (e) {
                        this.writer?.writeError(`Failed to parse plan generation: ${e}`, {
                            toolName: 'create_plan',
                            recoverable: true,
                            context: text.slice(0, 200),
                        });
                        return {
                            success: false,
                            error: `Failed to parse plan generation: ${e}. Response was: ${text.slice(0, 200)}`,
                        };
                    }
                    operation?.milestone('Parsed structured plan response', { phase: 'parse' });

                    // Create plan object
                    const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
                    const plan: Plan = {
                        id: planId,
                        title: planData.title,
                        createdAt: new Date().toISOString(),
                        problem: planData.problem,
                        solution: planData.solution,
                        requirements: planData.requirements || [],
                        phases: planData.phases || [],
                        milestones: planData.milestones || [],
                        risks: planData.risks || [],
                    };

                    // Save plan
                    this.currentPlan = plan;
                    operation?.milestone(`Saving plan "${plan.title}"`, { phase: 'persist' });
                    await this.savePlanToFile(plan);
                    operation?.complete(`Plan created: ${plan.title}`, { phase: 'complete' });

                    return {
                        success: true,
                        planId: plan.id,
                        title: plan.title,
                        phases: plan.phases.length,
                        milestones: plan.milestones.length,
                    };
                },
            }),

            generate_tasks_from_plan: tool({
                description: `Generate specific actionable tasks from the current plan. Tasks will include planId and planReference in metadata.`,
                inputSchema: z.object({
                    maxTasks: z.number().optional().default(8).describe('Maximum number of tasks to generate'),
                }),
                execute: async ({ maxTasks }) => {
                    if (!this.model) {
                        this.writer?.writeError('No model available for task generation', {
                            toolName: 'generate_tasks_from_plan',
                            recoverable: true,
                        });
                        return {
                            success: false,
                            error: 'No model available for task generation',
                        };
                    }

                    const operation = this.createOperation('generate-tasks-from-plan', 'generate_tasks_from_plan');

                    // Load current plan if not in memory
                    let plan = this.currentPlan;
                    if (!plan) {
                        operation?.milestone('Loading saved plan from disk', { phase: 'load' });
                        plan = await this.loadPlanFromFile() || undefined;
                    }

                    if (!plan) {
                        this.writer?.writeError('No plan found. Use create_plan() first.', {
                            toolName: 'generate_tasks_from_plan',
                            recoverable: true,
                        });
                        return {
                            success: false,
                            error: 'No plan found. Use create_plan() first.',
                        };
                    }

                    // Build plan context for LLM
                    const planContext = `
## Plan: ${plan.title}
**Plan ID**: ${plan.id}

### Problem
${plan.problem}

### Solution
${plan.solution}

### Requirements
${(plan.requirements || []).map(r => `- ${r}`).join('\n')}

### Phases
${plan.phases.map((p, i) => {
                        let s = `${i + 1}. ${p.name} - ${p.goal}`;
                        if (p.steps && p.steps.length > 0) {
                            s += '\n' + p.steps.map(step => `   - ${step}`).join('\n');
                        }
                        return s;
                    }).join('\n')}

### Milestones
${plan.milestones.map(m => `- ${m}`).join('\n')}
`;

                    operation?.milestone(`Generating implementation tasks for "${plan.title}"`, { phase: 'model' });
                    const { text } = await generateText({
                        model: this.model,
                        system: `You are an expert Implementation Engineer. Your job is to translate a project plan into high-fidelity, actionable tasks.

RULES:
1. Create 3-${maxTasks} tasks.
2. Each task MUST be extremely SPECIFIC, TECHNICAL, and ACTIONABLE.
3. Reference EXACT files and line areas where possible (e.g., "In src/components/button.tsx, add the following props...").
4. Tasks MUST be sequential and follow the plan's phases.
5. For each task, provide a robust description that leaves NO ambiguity about the implementation steps.
6. If the plan mentions specific requirements or architecture, incorporate those into the task details.
7. Focus on DELIVERABLES and concrete CHANGES.

Output ONLY valid JSON, no markdown formatting:
{
  "tasks": [
    {
      "title": "Clear technical title",
      "description": "Deeply detailed implementation instructions including logic, styles, and edge cases.",
      "planPhase": "Phase name this task belongs to",
      "planReference": "Specific plan section (e.g., Phase 1 -> Step 2)",
      "priority": "high",
      "fileReferences": ["path/to/file"]
    }
  ]
}

The planReference field should be a clear path to the plan section so you can trace back exactly why this task exists.`,
                        prompt: `Generate tasks from this plan:\n\n${planContext}`,
                    });

                    // Parse JSON response
                    let tasksData: { tasks: any[] };
                    try {
                        const jsonMatch = text.match(/```json\s*(\{[\s\S]*\})\s*```/) ||
                            text.match(/```\s*(\{[\s\S]*\})\s*```/) ||
                            text.match(/(\{[\s\S]*\})/);
                        if (!jsonMatch) {
                            throw new Error('No JSON found in response');
                        }
                        tasksData = JSON.parse(jsonMatch[1]);
                    } catch (e) {
                        this.writer?.writeError(`Failed to parse task generation: ${e}`, {
                            toolName: 'generate_tasks_from_plan',
                            recoverable: true,
                            context: text.slice(0, 200),
                        });
                        return {
                            success: false,
                            error: `Failed to parse task generation: ${e}. Response was: ${text.slice(0, 200)}`,
                        };
                    }
                    operation?.milestone(`Parsed ${tasksData.tasks.length} planned task${tasksData.tasks.length === 1 ? '' : 's'}`, {
                        phase: 'parse',
                    });

                    // Create tasks with plan metadata
                    const now = new Date().toISOString();
                    const createdTasks: TaskItem[] = [];

                    for (let i = 0; i < tasksData.tasks.length; i++) {
                        const taskDef = tasksData.tasks[i];
                        const id = `task_${Date.now()}_${i}`;

                        // Handle dependencies (previous tasks)
                        const blockedBy = i > 0 ? [`task_${Date.now()}_${i - 1}`] : [];

                        const newTask: TaskItem = {
                            id,
                            type: TaskType.UserRequest,
                            title: taskDef.title,
                            description: taskDef.description,
                            status: i === 0 ? 'pending' : 'blocked',
                            priority: taskDef.priority || 'medium',
                            createdAt: now,
                            updatedAt: now,
                            blocks: [],
                            blockedBy,
                            fileReferences: taskDef.fileReferences || [],
                            taskReferences: [],
                            urlReferences: [],
                            metadata: {
                                planId: plan.id,
                                planPhase: taskDef.planPhase || '',
                                planReference: taskDef.planReference || '',
                            },
                            tags: [],
                        };

                        // Update previous task's blocks
                        if (i > 0 && createdTasks[i - 1]) {
                            createdTasks[i - 1].blocks.push(id);
                        }

                        createdTasks.push(newTask);
                        await this.tasksPlugin.addTask(newTask);

                        this.writer?.writeTaskUpdate(newTask.id, newTask.status, newTask.title);
                    }

                    // Persist tasks
                    operation?.milestone(`Persisting ${createdTasks.length} task${createdTasks.length === 1 ? '' : 's'} from the plan`, {
                        phase: 'persist',
                    });
                    await (this.tasksPlugin as any).persistTasks();
                    this.tasksPlugin.streamTaskGraph();
                    operation?.complete(`Generated ${createdTasks.length} task${createdTasks.length === 1 ? '' : 's'} from ${plan.title}`, {
                        phase: 'complete',
                    });

                    return {
                        success: true,
                        message: `Generated ${createdTasks.length} tasks from plan "${plan.title}"`,
                        planId: plan.id,
                        tasks: createdTasks.map(t => ({
                            id: t.id,
                            title: t.title,
                            planPhase: t.metadata.planPhase,
                        })),
                    };
                },
            }),

            save_plan: tool({
                description: `Save the current task plan to a file for persistence and cross-session continuity.`,
                inputSchema: z.object({
                    path: z.string().optional().describe('File path to save plan (default: workspace/plan.md)'),
                }),
                execute: async ({ path }) => {
                    const operation = this.createOperation('save-plan', 'save_plan');
                    const savePath = path || this.planPath;
                    const tasks = await this.tasksPlugin.getTasks();
                    operation?.milestone(`Saving task plan to ${savePath}`, { phase: 'persist' });

                    let content = `# Task Plan\n\n`;
                    content += `Generated: ${new Date().toISOString()}\n`;
                    content += `Total tasks: ${tasks.length}\n\n`;

                    const byStatus: Record<string, TaskItem[]> = {
                        'in_progress': [],
                        'pending': [],
                        'blocked': [],
                        'completed': [],
                        'failed': [],
                    };

                    for (const task of tasks) {
                        if (byStatus[task.status]) {
                            byStatus[task.status].push(task);
                        }
                    }

                    for (const [status, statusTasks] of Object.entries(byStatus)) {
                        if (statusTasks.length === 0) continue;
                        content += `## ${status.toUpperCase()} (${statusTasks.length})\n\n`;
                        for (const task of statusTasks) {
                            content += `### ${task.title}\n`;
                            content += `- **ID**: \`${task.id}\`\n`;
                            content += `- **Priority**: ${task.priority}\n`;
                            if (task.description) {
                                content += `- **Description**: ${task.description}\n`;
                            }
                            if (task.blockedBy.length > 0) {
                                content += `- **Blocked by**: ${task.blockedBy.join(', ')}\n`;
                            }
                            content += '\n';
                        }
                    }

                    const fullPath = require('path').resolve(process.cwd(), savePath);
                    Bun.spawnSync(['mkdir', '-p', require('path').dirname(fullPath)]);
                    await Bun.write(fullPath, content);

                    operation?.complete(`Plan saved to ${savePath}`, { phase: 'complete' });

                    return { success: true, path: savePath, taskCount: tasks.length };
                },
            }),

            load_plan: tool({
                description: `Load a task plan from a file.`,
                inputSchema: z.object({
                    path: z.string().optional().describe('File path to load plan from (default: workspace/plan.md)'),
                    clearExisting: z.boolean().default(false).describe('Clear existing tasks before loading'),
                }),
                execute: async ({ path, clearExisting }) => {
                    const operation = this.createOperation('load-plan', 'load_plan');
                    const loadPath = path || this.planPath;
                    const fullPath = require('path').resolve(process.cwd(), loadPath);
                    try {
                        operation?.milestone(`Loading plan from ${loadPath}`, { phase: 'load' });
                        const content = await Bun.file(fullPath).text();
                        if (clearExisting) {
                            operation?.milestone('Clearing existing tasks before applying loaded plan', {
                                phase: 'clear',
                            });
                        }
                        operation?.complete(`Plan loaded from ${loadPath}`, { phase: 'complete' });

                        return {
                            success: true,
                            content: content,
                            message: 'Plan content loaded.',
                        };
                    } catch (error) {
                        this.writer?.writeError(error instanceof Error ? error.message : String(error), {
                            toolName: 'load_plan',
                            recoverable: true,
                            context: loadPath,
                        });
                        return {
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        };
                    }
                },
            }),

            recite_plan: tool({
                description: `Manually trigger plan recitation.`,
                inputSchema: z.object({}),
                execute: async () => {
                    const operation = this.createOperation('recite-plan', 'recite_plan');
                    operation?.milestone('Refreshing plan recitation cache', { phase: 'refresh' });
                    await this.refreshRecitationCache();
                    const tasks = this.lastRecitedTasks;
                    operation?.complete(`Recited ${tasks.length} active task${tasks.length === 1 ? '' : 's'}`, {
                        phase: 'complete',
                    });

                    return {
                        success: true,
                        recitation: this.formatPlanForRecitation(tasks),
                        activeCount: tasks.length,
                    };
                },
            }),

            create_subtask: tool({
                description: `Create a subtask under an existing parent task.`,
                inputSchema: z.object({
                    parentTaskId: z.string().describe('ID of the parent task'),
                    title: z.string().describe('Title of the subtask'),
                    description: z.string().describe('Description of what the subtask involves'),
                    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
                }),
                execute: async ({ parentTaskId, title, description, priority }) => {
                    const operation = this.createOperation('create-subtask', 'create_subtask');
                    const tasks = await this.tasksPlugin.getTasks();
                    const parent = tasks.find(t => t.id === parentTaskId);

                    if (!parent) {
                        this.writer?.writeError(`Parent task not found: ${parentTaskId}`, {
                            toolName: 'create_subtask',
                            recoverable: true,
                        });
                        return { success: false, error: `Parent task not found: ${parentTaskId}` };
                    }

                    const now = new Date().toISOString();
                    const subtaskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

                    const subtask: TaskItem = {
                        id: subtaskId,
                        type: TaskType.SubTask,
                        title,
                        description,
                        status: 'blocked',
                        priority: priority || 'medium',
                        createdAt: now,
                        updatedAt: now,
                        blocks: [],
                        blockedBy: [parentTaskId],
                        fileReferences: [],
                        taskReferences: [],
                        urlReferences: [],
                        metadata: { parentTaskId },
                        tags: [],
                    };

                    await this.tasksPlugin.addTask(subtask);
                    await this.tasksPlugin.updateTask(parentTaskId, { blocks: [...parent.blocks, subtaskId] });

                    await this.refreshRecitationCache();
                    this.writer?.writeTaskUpdate(subtaskId, 'blocked', title);
                    this.tasksPlugin.streamTaskGraph();
                    operation?.complete(`Created subtask "${title}"`, { phase: 'complete' });

                    return { success: true, subtaskId, message: `Created subtask "${title}" under ${parentTaskId}` };
                },
            }),
        });
    }

    async onStreamFinish(): Promise<void> {
        await this.tasksPlugin.onStreamFinish();
        await this.refreshRecitationCache();
    }
}

export default PlanningPlugin;
