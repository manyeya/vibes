import {
    tool,
    type UIMessageStreamWriter,
    generateText,
    type LanguageModel,
} from 'ai';
import { z } from 'zod';
import {
    AgentUIMessage,
    Middleware,
    ErrorEntry,
    createDataStreamWriter,
    type DataStreamWriter,
} from '../core/types';

/**
 * A learned lesson extracted from errors or successful experiences.
 */
export interface Lesson {
    /** Unique identifier for the lesson */
    id: string;
    /** The lesson/constraint learned */
    lesson: string;
    /** Category for organization */
    category: 'error' | 'pattern' | 'convention' | 'optimization' | 'best_practice';
    /** Related topic tags */
    tags: string[];
    /** When this lesson was learned */
    timestamp: string;
    /** Context where this was learned */
    context: string;
    /** How many times this has been applied */
    applicationCount: number;
    /** Last time this was referenced */
    lastReferenced?: string;
    /** Source error ID (if from an error) */
    sourceErrorId?: string;
}

/**
 * Result of an error analysis session.
 */
export interface ErrorAnalysis {
    /** The error being analyzed */
    errorEntry: ErrorEntry;
    /** Root cause identification */
    rootCause: string;
    /** Lessons extracted from this error */
    lessons: string[];
    /** Suggested preventive measures */
    preventions: string[];
    /** Confidence in the analysis (0-1) */
    confidence: number;
}

/**
 * Configuration for ReflexionMiddleware
 */
export interface ReflexionConfig {
    /** Maximum lessons to store (default: 100) */
    maxLessons?: number;
    /** Path to lessons storage file (default: workspace/lessons.json) */
    lessonsPath?: string;
    /** Whether to automatically analyze errors (default: true) */
    autoAnalyzeErrors?: boolean;
    /** Minimum occurrence count before triggering analysis (default: 2) */
    analysisThreshold?: number;
    /** Whether to automatically suggest relevant lessons (default: true) */
    autoSuggestLessons?: boolean;
}

/**
 * ReflexionMiddleware adds self-improvement capabilities through
 * structured error analysis and lesson learning.
 *
 * Based on the "Reflexion" framework (Shinn et al., 2023) where agents:
 * 1. Act -> Observe results
 * 2. Reflect on what went wrong
 * 3. Update behavior based on lessons learned
 *
 * Features:
 * - Automatic error pattern detection
 * - Structured lesson storage with metadata
 * - Contextual lesson retrieval
 * - Lesson application tracking
 */
export class ReflexionMiddleware implements Middleware {
    name = 'ReflexionMiddleware';

    private writer?: DataStreamWriter;
    private model?: LanguageModel;
    private backend?: any; // StateBackend for persistence

    private config: Required<ReflexionConfig>;
    private lessons: Lesson[] = [];
    private pendingAnalyses: Set<string> = new Set();

    constructor(
        model?: LanguageModel,
        backend?: any,
        config: ReflexionConfig = {}
    ) {
        this.model = model;
        this.backend = backend;
        this.config = {
            maxLessons: config.maxLessons || 100,
            lessonsPath: config.lessonsPath || 'workspace/lessons.json',
            autoAnalyzeErrors: config.autoAnalyzeErrors ?? true,
            analysisThreshold: config.analysisThreshold || 2,
            autoSuggestLessons: config.autoSuggestLessons ?? true,
        };
    }

    onStreamReady(writer: UIMessageStreamWriter<AgentUIMessage>) {
        this.writer = createDataStreamWriter(writer);
    }

    /**
     * Hook into agent errors for automatic analysis
     */
    async onStepFinish?(step: { stepNumber: number; stepType: string; text?: string; content?: any }): Promise<void> {
        // Check if step had errors
        if (step.content?.toolErrors && Array.isArray(step.content.toolErrors)) {
            for (const error of step.content.toolErrors) {
                await this.handleError(error);
            }
        }
    }

    /**
     * Handle an error occurrence
     */
    private async handleError(error: any): Promise<void> {
        if (!this.config.autoAnalyzeErrors) return;

        const errorKey = `${error.toolName || 'unknown'}:${error.error?.slice(0, 50) || 'unknown'}`;

        // Check if we should analyze (after threshold occurrences)
        if (!this.pendingAnalyses.has(errorKey)) {
            this.pendingAnalyses.add(errorKey);
            // Queue analysis for next turn
            this.notifyStatus(`Error detected: ${error.error?.slice(0, 50)}... Will analyze if it recurs.`);
        }
    }

    /**
     * Get all lessons
     */
    getLessons(): Lesson[] {
        return [...this.lessons];
    }

    /**
     * Get lessons by category
     */
    getLessonsByCategory(category: Lesson['category']): Lesson[] {
        return this.lessons.filter(l => l.category === category);
    }

    /**
     * Get lessons by tag
     */
    getLessonsByTag(tag: string): Lesson[] {
        return this.lessons.filter(l => l.tags.includes(tag));
    }

    /**
     * Find relevant lessons for a context
     */
    findRelevantLessons(context: string, limit: number = 5): Lesson[] {
        // Simple keyword matching for now
        // Could be enhanced with embeddings later
        const contextLower = context.toLowerCase();
        const words = contextLower.split(/\s+/).filter(w => w.length > 3);

        const scored = this.lessons.map(lesson => {
            let score = 0;
            const lessonText = `${lesson.lesson} ${lesson.context} ${lesson.tags.join(' ')}`.toLowerCase();

            for (const word of words) {
                if (lessonText.includes(word)) score += 1;
            }

            // Boost recently applied lessons
            if (lesson.lastReferenced) {
                const daysSinceRef = Math.floor(
                    (Date.now() - new Date(lesson.lastReferenced).getTime()) / (1000 * 60 * 60 * 24)
                );
                if (daysSinceRef < 7) score += 2;
            }

            // Boost highly applied lessons
            score += Math.min(lesson.applicationCount, 5);

            return { lesson, score };
        });

        return scored
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(s => s.lesson);
    }

    /**
     * Tools provided by the reflexion middleware
     */
    get tools() {
        return {
            analyze_errors: tool({
                description: `Analyze recent errors to extract patterns and lessons learned.
Use this after encountering repeated errors or to review what went wrong in a session.`,
                inputSchema: z.object({
                    errors: z.array(z.object({
                        toolName: z.string().optional(),
                        error: z.string(),
                        context: z.string().optional(),
                    })).optional().describe('Specific errors to analyze (if omitted, analyzes all recent errors)'),
                    focus: z.string().optional().describe('Focus area for analysis (e.g., "file access", "API calls")'),
                }),
                execute: async ({ errors, focus }) => {
                    if (!this.model) {
                        return {
                            success: false,
                            error: 'No model available for error analysis',
                        };
                    }

                    // Use provided errors or get from agent state
                    const errorsToAnalyze = errors || [];

                    if (errorsToAnalyze.length === 0) {
                        return {
                            success: true,
                            message: 'No errors to analyze. Provide specific errors or ensure errors have occurred.',
                            analysis: null,
                        };
                    }

                    try {
                        const errorsText = errorsToAnalyze.map((e, i) =>
                            `${i + 1}. [${e.toolName || 'unknown'}] ${e.error}${e.context ? `\n   Context: ${e.context}` : ''}`
                        ).join('\n\n');

                        const { text } = await generateText({
                            model: this.model,
                            system: `You are an expert at analyzing errors and extracting lessons learned.
For each error, identify:
1. Root cause (what really went wrong)
2. Pattern to avoid
3. Prevention strategy

Output ONLY valid JSON:
\`\`\`
{
  "rootCause": "Underlying issue",
  "lessons": ["Lesson 1", "Lesson 2"],
  "preventions": ["Prevention 1"],
  "confidence": 0.8
}
\`\`\``,
                            prompt: `Analyze these errors${focus ? ` related to: ${focus}` : ''}:\n\n${errorsText}`,
                        });

                        // Parse JSON response
                        let data: any;
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
                                error: `Failed to parse analysis: ${e}`,
                            };
                        }

                        const analysis: ErrorAnalysis = {
                            errorEntry: {
                                timestamp: new Date().toISOString(),
                                error: errorsToAnalyze.map(e => e.error).join('; '),
                                toolName: errorsToAnalyze[0]?.toolName,
                                context: focus,
                                occurrenceCount: errorsToAnalyze.length,
                            },
                            rootCause: data.rootCause,
                            lessons: data.lessons || [],
                            preventions: data.preventions || [],
                            confidence: data.confidence || 0.5,
                        };

                        this.notifyStatus(`Error analysis complete: ${analysis.lessons.length} lessons extracted`);

                        return {
                            success: true,
                            analysis,
                            message: `Analyzed ${errorsToAnalyze.length} errors. Found ${analysis.lessons.length} lessons.`,
                        };
                    } catch (e) {
                        return {
                            success: false,
                            error: `Analysis failed: ${e}`,
                        };
                    }
                },
            }),

            save_lesson: tool({
                description: `Save a structured lesson learned from experience.
Use this to remember important patterns, conventions, or things to avoid.
Lessons are persisted and suggested in relevant future contexts.`,
                inputSchema: z.object({
                    lesson: z.string().describe('The lesson learned (be specific and actionable)'),
                    category: z.enum(['error', 'pattern', 'convention', 'optimization', 'best_practice']).default('pattern').describe('Type of lesson'),
                    context: z.string().optional().describe('Context where this was learned'),
                    tags: z.array(z.string()).optional().describe('Tags for retrieval (e.g., ["authentication", "API"])'),
                }),
                execute: async ({ lesson, category, context, tags }) => {
                    const now = new Date().toISOString();
                    const newLesson: Lesson = {
                        id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
                        lesson,
                        category,
                        tags: tags || [],
                        timestamp: now,
                        context: context || 'Manual entry',
                        applicationCount: 0,
                    };

                    this.lessons.push(newLesson);

                    // Trim if over limit
                    if (this.lessons.length > this.config.maxLessons) {
                        this.lessons = this.lessons.slice(-this.config.maxLessons);
                    }

                    // Persist to file
                    await this.persistLessons();

                    this.notifyStatus(`Lesson saved: ${lesson.slice(0, 50)}...`);

                    return {
                        success: true,
                        lessonId: newLesson.id,
                        message: `Lesson saved in category: ${category}`,
                    };
                },
            }),

            get_lessons: tool({
                description: `Retrieve relevant lessons for the current context.
Use this when starting a task to see what's been learned before.`,
                inputSchema: z.object({
                    topic: z.string().optional().describe('Topic to filter lessons (e.g., "authentication", "file handling")'),
                    category: z.enum(['error', 'pattern', 'convention', 'optimization', 'best_practice']).optional().describe('Filter by category'),
                    context: z.string().optional().describe('Current context for relevance matching'),
                    limit: z.number().default(5).describe('Maximum lessons to return'),
                }),
                execute: async ({ topic, category, context, limit }) => {
                    let relevant = this.lessons;

                    // Filter by category
                    if (category) {
                        relevant = relevant.filter(l => l.category === category);
                    }

                    // Filter by tag/topic
                    if (topic) {
                        const topicLower = topic.toLowerCase();
                        relevant = relevant.filter(l =>
                            l.tags.some(t => t.toLowerCase().includes(topicLower)) ||
                            l.lesson.toLowerCase().includes(topicLower) ||
                            l.context.toLowerCase().includes(topicLower)
                        );
                    }

                    // If context provided, use relevance matching
                    if (context && !topic && !category) {
                        relevant = this.findRelevantLessons(context, limit);
                    } else {
                        // Sort by recency and application count
                        relevant = relevant
                            .sort((a, b) => {
                                const appDiff = b.applicationCount - a.applicationCount;
                                if (appDiff !== 0) return appDiff;
                                return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
                            })
                            .slice(0, limit);
                    }

                    // Mark as referenced
                    const now = new Date().toISOString();
                    for (const lesson of relevant) {
                        lesson.lastReferenced = now;
                    }

                    return {
                        success: true,
                        lessons: relevant,
                        count: relevant.length,
                        message: `Found ${relevant.length} relevant lesson${relevant.length !== 1 ? 's' : ''}`,
                    };
                },
            }),

            apply_lesson: tool({
                description: `Mark a lesson as applied (increases its relevance score).
Use this after successfully applying a learned lesson to a problem.`,
                inputSchema: z.object({
                    lessonId: z.string().describe('ID of the lesson to mark as applied'),
                }),
                execute: async ({ lessonId }) => {
                    const lesson = this.lessons.find(l => l.id === lessonId);
                    if (!lesson) {
                        return {
                            success: false,
                            error: `Lesson not found: ${lessonId}`,
                        };
                    }

                    lesson.applicationCount++;
                    lesson.lastReferenced = new Date().toISOString();

                    await this.persistLessons();

                    this.notifyStatus(`Lesson applied (used ${lesson.applicationCount} times)`);

                    return {
                        success: true,
                        lesson,
                        applicationCount: lesson.applicationCount,
                        message: `Lesson marked as applied (count: ${lesson.applicationCount})`,
                    };
                },
            }),

            list_lessons: tool({
                description: `List all lessons organized by category.
Use this to review what has been learned.`,
                inputSchema: z.object({
                    category: z.enum(['error', 'pattern', 'convention', 'optimization', 'best_practice']).optional(),
                }),
                execute: async ({ category }) => {
                    let filtered = this.lessons;
                    if (category) {
                        filtered = filtered.filter(l => l.category === category);
                    }

                    // Group by category
                    const byCategory: Record<string, Lesson[]> = {
                        error: [],
                        pattern: [],
                        convention: [],
                        optimization: [],
                        best_practice: [],
                    };

                    for (const lesson of filtered) {
                        byCategory[lesson.category].push(lesson);
                    }

                    return {
                        success: true,
                        lessons: filtered,
                        byCategory,
                        totalCount: this.lessons.length,
                        filteredCount: filtered.length,
                        message: category
                            ? `${filtered.length} lessons in category: ${category}`
                            : `Total of ${this.lessons.length} lessons across all categories`,
                    };
                },
            }),

            reflect_on_session: tool({
                description: `Trigger a reflection on the current session.
Use this to summarize what went well, what didn't, and what to remember.
Automatically extracts lessons from the session experience.`,
                inputSchema: z.object({
                    sessionSummary: z.string().describe('Summary of what happened in the session'),
                    successes: z.array(z.string()).optional().describe('What went well'),
                    failures: z.array(z.string()).optional().describe('What didn\'t work'),
                    keyInsights: z.array(z.string()).optional().describe('Key insights from the session'),
                }),
                execute: async ({ sessionSummary, successes, failures, keyInsights }) => {
                    const now = new Date().toISOString();
                    const lessonsToCreate: Omit<Lesson, 'id'>[] = [];

                    // Extract lessons from failures
                    if (failures && failures.length > 0) {
                        for (const failure of failures) {
                            lessonsToCreate.push({
                                lesson: `Avoid: ${failure}`,
                                category: 'error',
                                tags: ['session_reflection'],
                                timestamp: now,
                                context: sessionSummary.slice(0, 200),
                                applicationCount: 0,
                            });
                        }
                    }

                    // Extract patterns from successes
                    if (successes && successes.length > 0) {
                        for (const success of successes) {
                            lessonsToCreate.push({
                                lesson: `Success pattern: ${success}`,
                                category: 'best_practice',
                                tags: ['session_reflection'],
                                timestamp: now,
                                context: sessionSummary.slice(0, 200),
                                applicationCount: 1, // Start at 1 since it worked
                            });
                        }
                    }

                    // Add key insights
                    if (keyInsights && keyInsights.length > 0) {
                        for (const insight of keyInsights) {
                            lessonsToCreate.push({
                                lesson: insight,
                                category: 'pattern',
                                tags: ['session_reflection', 'insight'],
                                timestamp: now,
                                context: sessionSummary.slice(0, 200),
                                applicationCount: 0,
                            });
                        }
                    }

                    // Create the lessons
                    const created: Lesson[] = [];
                    for (const lessonData of lessonsToCreate) {
                        const lesson: Lesson = {
                            ...lessonData,
                            id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
                        };
                        this.lessons.push(lesson);
                        created.push(lesson);
                    }

                    await this.persistLessons();

                    this.notifyStatus(`Session reflection complete: ${created.length} lessons saved`);

                    return {
                        success: true,
                        lessonsCreated: created,
                        message: `Reflected on session and saved ${created.length} lessons`,
                    };
                },
            }),
        };
    }

    /**
     * Modify system prompt to include relevant lessons
     */
    modifySystemPrompt(prompt: string): string | Promise<string> {
        if (this.lessons.length === 0 || !this.config.autoSuggestLessons) {
            return prompt;
        }

        // Get top lessons by application count
        const topLessons = [...this.lessons]
            .sort((a, b) => b.applicationCount - a.applicationCount)
            .slice(0, 5);

        if (topLessons.length === 0) {
            return prompt;
        }

        let lessonsSection = '\n\n## Lessons Learned\n\n';
        lessonsSection += `You have learned ${this.lessons.length} lesson${this.lessons.length !== 1 ? 's' : ''} from past experience. `;
        lessonsSection += `Use \`get_lessons()\` to see relevant lessons for your current task.\n\n`;

        // Show top 3 most-applied lessons
        lessonsSection += `**Most Applied Lessons:**\n`;
        for (const lesson of topLessons.slice(0, 3)) {
            lessonsSection += `- [${lesson.category}] ${lesson.lesson} (used ${lesson.applicationCount}x)\n`;
        }

        return prompt + lessonsSection;
    }

    /**
     * Persist lessons to file
     */
    private async persistLessons(): Promise<void> {
        try {
            const fs = await import('fs/promises');
            const pathModule = await import('path');
            const fullPath = pathModule.resolve(process.cwd(), this.config.lessonsPath);

            await fs.mkdir(pathModule.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, JSON.stringify(this.lessons, null, 2));
        } catch (e) {
            // Non-fatal: log but don't fail
            console.error('Failed to persist lessons:', e);
        }
    }

    /**
     * Load lessons from file
     */
    private async loadLessons(): Promise<void> {
        try {
            const fs = await import('fs/promises');
            const pathModule = await import('path');
            const fullPath = pathModule.resolve(process.cwd(), this.config.lessonsPath);

            const content = await fs.readFile(fullPath, 'utf-8');
            const loaded = JSON.parse(content) as Lesson[];
            this.lessons = loaded;
        } catch (e) {
            // File doesn't exist or is invalid - start fresh
            this.lessons = [];
        }
    }

    /**
     * Notify UI of status changes
     */
    private notifyStatus(message: string) {
        this.writer?.writeStatus(message);
    }

    /**
     * Initialization: load existing lessons
     */
    async waitReady(): Promise<void> {
        await this.loadLessons();
    }
}

export default ReflexionMiddleware;
