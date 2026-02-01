import {
    tool,
    type UIMessageStreamWriter,
    generateText,
    type LanguageModel,
} from 'ai';
import { z } from 'zod';
import { VibesUIMessage, Middleware } from '../core/types';

/**
 * Reasoning modes supported by the middleware
 */
export type ReasoningMode = 'react' | 'tot' | 'plan-execute';

/**
 * A single thought/reasoning branch in Tree-of-Thoughts
 */
export interface ThoughtBranch {
    /** Unique identifier for this branch */
    id: string;
    /** The reasoning/thought content */
    thought: string;
    /** Expected outcome if this path is followed */
    expectedOutcome: string;
    /** Confidence score (0-1) */
    confidence: number;
    /** Estimated effort/cost */
    effort: 'low' | 'medium' | 'high';
    /** Status of this thought */
    status: 'proposed' | 'evaluated' | 'selected' | 'discarded';
}

/**
 * Evaluation result for a thought branch
 */
export interface ThoughtEvaluation {
    /** Thought ID being evaluated */
    thoughtId: string;
    /** Quality score (0-10) */
    qualityScore: number;
    /** Feasibility score (0-10) */
    feasibilityScore: number;
    /** Expected value score (0-10) */
    valueScore: number;
    /** Overall score (weighted average) */
    overallScore: number;
    /** Reasoning for the score */
    reasoning: string;
}

/**
 * Reasoning state tracked across the session
 */
interface ReasoningState {
    /** Current reasoning mode */
    mode: ReasoningMode;
    /** Current thought branches (for ToT) */
    branches: ThoughtBranch[];
    /** Evaluation history */
    evaluations: ThoughtEvaluation[];
    /** Number of reasoning cycles completed */
    cycleCount: number;
}

/**
 * Configuration for ReasoningMiddleware
 */
export interface ReasoningConfig {
    /** Initial reasoning mode (default: 'react') */
    initialMode?: ReasoningMode;
    /** Maximum thought branches to generate in ToT mode */
    maxBranches?: number;
    /** Whether to automatically explore thoughts in complex scenarios */
    autoExplore?: boolean;
    /** Threshold for considering a scenario "complex" (steps required) */
    complexityThreshold?: number;
}

/**
 * ReasoningMiddleware provides multiple reasoning patterns:
 *
 * **ReAct (Reasoning + Acting)**: Default think-act loop for dynamic environments
 * - Agent thinks about the current state
 * - Takes an action
 * - Observes the result
 * - Repeats
 *
 * **Tree-of-Thoughts (ToT)**: Parallel exploration for complex problem-solving
 * - Generate multiple reasoning branches
 * - Evaluate each branch for quality, feasibility, value
 * - Select the best path to pursue
 * - Enables backtracking and exploring alternatives
 *
 * **Plan-Execute**: Separate planning and execution phases
 * - First, create a comprehensive plan
 * - Then, execute the plan step by step
 * - Reduces mid-execution re-planning
 *
 * Based on research from:
 * - "Tree of Thoughts" (Yao et al., 2023)
 * - "Reflexion: Language Agents with Verbal Reinforcement Learning"
 */
export class ReasoningMiddleware implements Middleware {
    name = 'ReasoningMiddleware';

    private writer?: UIMessageStreamWriter<VibesUIMessage>;
    private model?: LanguageModel;
    private config: Required<ReasoningConfig>;

    /** Internal reasoning state */
    private state: ReasoningState = {
        mode: 'react',
        branches: [],
        evaluations: [],
        cycleCount: 0,
    };

    constructor(
        model?: LanguageModel,
        config: ReasoningConfig = {}
    ) {
        this.model = model;
        this.config = {
            initialMode: config.initialMode || 'react',
            maxBranches: config.maxBranches || 5,
            autoExplore: config.autoExplore ?? true,
            complexityThreshold: config.complexityThreshold || 5,
        };
        this.state.mode = this.config.initialMode;
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.writer = writer;
    }

    /**
     * Get current reasoning mode
     */
    getMode(): ReasoningMode {
        return this.state.mode;
    }

    /**
     * Get current reasoning state (for debugging/visualization)
     */
    getState(): ReasoningState {
        return { ...this.state };
    }

    /**
     * Tools provided by the reasoning middleware
     */
    get tools() {
        return {

            set_reasoning_mode: tool({
                description: `Switch between reasoning modes:
- react: Think-act loop (default, good for most tasks)
- tot: Tree-of-Thoughts (for complex problems with multiple approaches)
- plan-execute: Separate planning then execution (for structured tasks)

Use 'tot' when facing ambiguity or multiple valid approaches.
Use 'plan-execute' for well-defined, multi-step processes.`,
                inputSchema: z.object({
                    mode: z.enum(['react', 'tot', 'plan-execute']).describe('The reasoning mode to switch to'),
                }),
                execute: async ({ mode }) => {
                    const previousMode = this.state.mode;
                    this.state.mode = mode;

                    // Reset state when switching modes
                    this.state.branches = [];
                    this.state.evaluations = [];
                    this.state.cycleCount = 0;

                    this.notifyStatus(`Switched reasoning mode: ${previousMode} → ${mode}`);

                    return {
                        success: true,
                        previousMode,
                        currentMode: mode,
                        message: `Now using ${mode} reasoning mode`,
                    };
                },
            }),

            explore_thoughts: tool({
                description: `Generate multiple reasoning branches to explore different approaches.
Use this when:
- Facing a complex problem with multiple possible solutions
- Uncertain about the best approach
- Need to compare alternatives before committing

Creates N thought branches, each with a proposed approach and expected outcome.`,
                inputSchema: z.object({
                    problem: z.string().describe('The problem or decision to explore'),
                    count: z.number().min(2).max(10).default(3).describe('Number of thought branches to generate'),
                    context: z.string().optional().describe('Additional context about the current state'),
                }),
                execute: async ({ problem, count, context }) => {
                    if (!this.model) {
                        return {
                            success: false,
                            error: 'No model available for thought generation',
                        };
                    }

                    const actualCount = Math.min(count, this.config.maxBranches);

                    try {
                        const { text } = await generateText({
                            model: this.model,
                            system: `You are an expert at exploring multiple approaches to complex problems.
Generate distinct, diverse reasoning branches - avoid similar variations.

For each branch:
1. Propose a clear approach
2. Explain the reasoning behind it
3. Describe the expected outcome
4. Estimate confidence (0-1)
5. Estimate effort (low/medium/high)

Output ONLY valid JSON:
\`\`\`
{
  "thoughts": [
    {
      "thought": "Approach description",
      "expectedOutcome": "What we expect to achieve",
      "confidence": 0.8,
      "effort": "medium"
    }
  ]
}
\`\`\``,
                            prompt: `Generate ${actualCount} distinct approaches to solve this problem:

${problem}

${context ? `\nContext:\n${context}` : ''}`,
                        });

                        // Parse JSON response
                        let data: { thoughts: any[] };
                        try {
                            const jsonMatch = text.match(/```json\s*(\{[\s\S]*\})\s*```/) ||
                                            text.match(/```\s*(\{[\s\S]*\})\s*```/) ||
                                            text.match(/(\{[\s\S]*\})/);
                            if (!jsonMatch) {
                                throw new Error('No JSON found in response');
                            }
                            data = JSON.parse(jsonMatch[1]);
                        } catch (e) {
                            return {
                                success: false,
                                error: `Failed to parse thoughts: ${e}`,
                            };
                        }

                        // Create thought branches
                        const branches: ThoughtBranch[] = [];
                        for (let i = 0; i < Math.min(data.thoughts.length, actualCount); i++) {
                            const t = data.thoughts[i];
                            branches.push({
                                id: `thought_${Date.now()}_${i}`,
                                thought: t.thought,
                                expectedOutcome: t.expectedOutcome,
                                confidence: t.confidence ?? 0.5,
                                effort: t.effort || 'medium',
                                status: 'proposed',
                            });
                        }

                        this.state.branches = branches;
                        this.state.cycleCount++;

                        this.notifyThoughts(branches);

                        return {
                            success: true,
                            branches,
                            count: branches.length,
                            message: `Generated ${branches.length} thought branches. Use evaluate_thoughts() to score them.`,
                        };
                    } catch (e) {
                        return {
                            success: false,
                            error: `Thought generation failed: ${e}`,
                        };
                    }
                },
            }),

            evaluate_thoughts: tool({
                description: `Evaluate thought branches on quality, feasibility, and value.
Scores each thought 0-10 on each dimension and provides an overall score.
Use after explore_thoughts() to decide which approach to pursue.`,
                inputSchema: z.object({
                    criteria: z.string().optional().describe('Custom evaluation criteria (e.g., "prioritize speed over quality")'),
                    context: z.string().optional().describe('Additional context for evaluation'),
                }),
                execute: async ({ criteria, context }) => {
                    if (this.state.branches.length === 0) {
                        return {
                            success: false,
                            error: 'No thought branches to evaluate. Use explore_thoughts() first.',
                        };
                    }

                    if (!this.model) {
                        return {
                            success: false,
                            error: 'No model available for evaluation',
                        };
                    }

                    // Format thoughts for evaluation
                    const thoughtsText = this.state.branches.map((b, i) =>
                        `${i + 1}. ${b.thought}\n   Expected: ${b.expectedOutcome}\n   Confidence: ${b.confidence}\n   Effort: ${b.effort}`
                    ).join('\n\n');

                    try {
                        const { text } = await generateText({
                            model: this.model,
                            system: `You are an expert evaluator. Score each thought branch 0-10 on:
- quality: How well does this approach solve the problem?
- feasibility: How likely is this to succeed?
- value: What's the expected value/impact?

Output ONLY valid JSON:
\`\`\`
{
  "evaluations": [
    {
      "thoughtId": "thought_ID",
      "qualityScore": 8,
      "feasibilityScore": 7,
      "valueScore": 9,
      "overallScore": 8,
      "reasoning": "Brief explanation"
    }
  ]
}
\`\`\``,
                            prompt: `Evaluate these thought branches:

${thoughtsText}

${criteria ? `\nCriteria: ${criteria}` : ''}

${context ? `\nContext:\n${context}` : ''}`,
                        });

                        // Parse JSON response
                        let data: { evaluations: any[] };
                        try {
                            const jsonMatch = text.match(/```json\s*(\{[\s\S]*\})\s*```/) ||
                                            text.match(/```\s*(\{[\s\S]*\})\s*```/) ||
                                            text.match(/(\{[\s\S]*\})/);
                            if (!jsonMatch) {
                                throw new Error('No JSON found in response');
                            }
                            data = JSON.parse(jsonMatch[1]);
                        } catch (e) {
                            return {
                                success: false,
                                error: `Failed to parse evaluations: ${e}`,
                            };
                        }

                        // Match evaluations to branches by index
                        const evaluations: ThoughtEvaluation[] = [];
                        for (let i = 0; i < Math.min(data.evaluations.length, this.state.branches.length); i++) {
                            const evalData = data.evaluations[i];
                            const branch = this.state.branches[i];
                            evaluations.push({
                                thoughtId: branch.id,
                                qualityScore: evalData.qualityScore,
                                feasibilityScore: evalData.feasibilityScore,
                                valueScore: evalData.valueScore,
                                overallScore: evalData.overallScore,
                                reasoning: evalData.reasoning,
                            });
                            // Update branch status
                            branch.status = 'evaluated';
                        }

                        this.state.evaluations = evaluations;

                        this.notifyEvaluations(evaluations);

                        // Find best thought
                        const best = evaluations.reduce((a, b) =>
                            a.overallScore > b.overallScore ? a : b
                        );

                        return {
                            success: true,
                            evaluations,
                            bestThoughtId: best.thoughtId,
                            bestScore: best.overallScore,
                            message: `Evaluated ${evaluations.length} thoughts. Best: ${best.thoughtId} (score: ${best.overallScore}/10)`,
                        };
                    } catch (e) {
                        return {
                            success: false,
                            error: `Evaluation failed: ${e}`,
                        };
                    }
                },
            }),

            select_best_thought: tool({
                description: `Select the highest-scoring thought branch and pursue it.
Updates branch status to 'selected' and returns details for execution.
Use after evaluate_thoughts().`,
                inputSchema: z.object({
                    thoughtId: z.string().optional().describe('Specific thought ID to select (if not provided, selects the highest-scored)'),
                    autoDiscard: z.boolean().default(true).describe('Mark other thoughts as discarded'),
                }),
                execute: async ({ thoughtId, autoDiscard }) => {
                    if (this.state.evaluations.length === 0) {
                        return {
                            success: false,
                            error: 'No evaluations available. Use evaluate_thoughts() first.',
                        };
                    }

                    // Find target evaluation
                    let selected: ThoughtEvaluation | undefined;
                    if (thoughtId) {
                        selected = this.state.evaluations.find(e => e.thoughtId === thoughtId);
                    } else {
                        // Select highest-scoring
                        selected = this.state.evaluations.reduce((a, b) =>
                            a.overallScore > b.overallScore ? a : b
                        );
                    }

                    if (!selected) {
                        return {
                            success: false,
                            error: 'Selected thought not found',
                        };
                    }

                    // Update branch statuses
                    for (const branch of this.state.branches) {
                        if (branch.id === selected.thoughtId) {
                            branch.status = 'selected';
                        } else if (autoDiscard) {
                            branch.status = 'discarded';
                        }
                    }

                    const selectedBranch = this.state.branches.find(b => b.id === selected.thoughtId);

                    this.notifyStatus(`Selected thought: ${selectedBranch?.thought.slice(0, 50)}... (score: ${selected.overallScore}/10)`);

                    return {
                        success: true,
                        selectedThought: selectedBranch,
                        evaluation: selected,
                        message: `Selected thought with score ${selected.overallScore}/10`,
                    };
                },
            }),

            get_reasoning_state: tool({
                description: `Get current reasoning state including mode, branches, and evaluations.
Useful for reviewing the reasoning process before making decisions.`,
                inputSchema: z.object({}),
                execute: async () => {
                    return {
                        success: true,
                        mode: this.state.mode,
                        cycleCount: this.state.cycleCount,
                        branchCount: this.state.branches.length,
                        evaluationCount: this.state.evaluations.length,
                        branches: this.state.branches,
                        evaluations: this.state.evaluations,
                    };
                },
            }),

            create_execution_plan: tool({
                description: `Create a detailed execution plan for the current task.
Use this in plan-execute mode to break down work into a structured plan before execution.`,
                inputSchema: z.object({
                    goal: z.string().describe('The goal to achieve'),
                    steps: z.array(z.object({
                        description: z.string(),
                        toolsNeeded: z.array(z.string()).optional(),
                        expectedOutput: z.string().optional(),
                    })).describe('The steps in the execution plan'),
                }),
                execute: async ({ goal, steps }) => {
                    const plan = {
                        id: `plan_${Date.now()}`,
                        goal,
                        steps: steps.map((s, i) => ({
                            stepNumber: i + 1,
                            ...s,
                            status: 'pending',
                        })),
                        createdAt: new Date().toISOString(),
                    };

                    this.state.cycleCount++;

                    this.notifyStatus(`Created execution plan with ${steps.length} steps`);

                    return {
                        success: true,
                        plan,
                        message: `Created plan with ${steps.length} steps. Execute each step in order.`,
                    };
                },
            }),
        };
    }

    /**
     * Modify system prompt based on current reasoning mode
     */
    modifySystemPrompt(prompt: string): string | Promise<string> {
        const modeInstructions: Record<ReasoningMode, string> = {
            react: `
## Reasoning Mode: ReAct (Reasoning + Acting)

You are using a think-act loop:
1. **Think**: Analyze the current state and what to do next
2. **Act**: Use tools to take action
3. **Observe**: Review the results
4. **Repeat** until the task is complete

Be explicit in your thinking. State your current understanding, what you're about to do, and why.`,

            tot: `
## Reasoning Mode: Tree-of-Thoughts

You are exploring multiple solution paths in parallel:
1. **Explore**: Use \`explore_thoughts()\` to generate different approaches
2. **Evaluate**: Use \`evaluate_thoughts()\` to score each approach
3. **Select**: Use \`select_best_thought()\` to choose the best path
4. **Execute**: Pursue the selected approach

This mode is ideal for complex problems with multiple valid approaches.
Use it when uncertain or when creativity is needed.`,

            'plan-execute': `
## Reasoning Mode: Plan-Execute

You follow a two-phase approach:
1. **Plan Phase**: Create a comprehensive execution plan using \`create_execution_plan()\`
2. **Execute Phase**: Follow the plan step by step

Only re-plan if:
- The plan is fundamentally flawed
- New critical information emerges
- Current approach is blocked

This mode reduces mid-execution re-planning and improves consistency.`,
        };

        return `${prompt}

${modeInstructions[this.state.mode]}

### Available Reasoning Tools
- \`set_reasoning_mode(mode)\` - Switch reasoning modes
- \`explore_thoughts(problem, count)\` - Generate multiple approaches (ToT)
- \`evaluate_thoughts()\` - Score thought branches (ToT)
- \`select_best_thought()\` - Choose best approach (ToT)
- \`create_execution_plan()\` - Create structured plan (plan-execute)
- \`get_reasoning_state()\` - Review current reasoning state
`;
    }

    /**
     * Hook before each step to potentially suggest mode switching.
     * This replaces the deprecated beforeModel hook.
     */
    async prepareStep(options: {
        steps: any[];
        stepNumber: number;
        model: import('ai').LanguageModel;
        messages: any[];
        experimental_context?: unknown;
    }): Promise<void> {
        // Auto-suggest ToT for complex scenarios
        if (this.config.autoExplore && this.state.mode === 'react') {
            const messages = options.messages || [];
            const toolCallCount = messages.filter((m: any) =>
                m.role === 'assistant' && m.content.some((c: any) => c.type === 'tool-call')
            ).length;

            // If we've made many tool calls without progress, suggest ToT
            if (toolCallCount > this.config.complexityThreshold) {
                this.notifyStatus(`Consider: Problem seems complex. Use 'tot' mode to explore alternatives.`);
            }
        }
    }

    /**
     * Notify UI of status changes
     */
    private notifyStatus(message: string) {
        this.writer?.write({
            type: 'data-status',
            data: { message },
        });
    }

    /**
     * Notify UI of new thought branches
     */
    private notifyThoughts(branches: ThoughtBranch[]) {
        this.writer?.write({
            type: 'data-status',
            data: {
                message: `Explored ${branches.length} thought branches`,
                step: this.state.cycleCount,
            },
        });
    }

    /**
     * Notify UI of evaluations
     */
    private notifyEvaluations(evaluations: ThoughtEvaluation[]) {
        const best = evaluations.reduce((a, b) =>
            a.overallScore > b.overallScore ? a : b
        );
        this.writer?.write({
            type: 'data-status',
            data: {
                message: `Evaluated ${evaluations.length} thoughts. Best score: ${best.overallScore}/10`,
                step: this.state.cycleCount,
            },
        });
    }

    /**
     * Optional initialization hook
     */
    async waitReady(): Promise<void> {
        // No async initialization needed
    }
}

export default ReasoningMiddleware;
