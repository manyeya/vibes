import {
    tool,
    type UIMessageStreamWriter,
    type LanguageModel,
    generateText,
} from 'ai';
import { z } from 'zod';
import { VibesUIMessage, Plugin } from '../core/types';

/**
 * A stored procedural pattern - reusable approach to solving problems.
 */
export interface Pattern {
    /** Unique identifier for the pattern */
    id: string;
    /** Human-readable name */
    name: string;
    /** Description of the pattern */
    description: string;
    /** When this pattern should be applied */
    whenToUse: string;
    /** Steps to follow when applying the pattern */
    steps: string[];
    /** Example of the pattern in action */
    example?: string;
    /** Category for organization */
    category: 'code' | 'workflow' | 'debugging' | 'testing' | 'documentation';
    /** Tags for retrieval */
    tags: string[];
    /** When this pattern was stored */
    timestamp: string;
    /** How many times this pattern has been applied */
    applicationCount: number;
    /** Last time this pattern was applied */
    lastApplied?: string;
    /** Success rate (0-1) */
    successRate?: number;
    /** Success count */
    successCount?: number;
    /** Failure count */
    failureCount?: number;
    /** Related file paths */
    fileReferences?: string[];
    /** Related URLs */
    urlReferences?: string[];
}

/**
 * Result of applying a pattern.
 */
export interface PatternApplication {
    /** The pattern that was applied */
    pattern: Pattern;
    /** Whether the application was successful */
    success: boolean;
    /** Any notes about the application */
    notes?: string;
}

/**
 * Configuration for ProceduralMemoryPlugin
 */
export interface ProceduralMemoryConfig {
    /** Maximum patterns to store (default: 50) */
    maxPatterns?: number;
    /** Path to patterns storage file (default: workspace/patterns.json) */
    patternsPath?: string;
    /** Whether to auto-suggest patterns (default: true) */
    autoSuggest?: boolean;
}

/**
 * ProceduralMemoryPlugin stores reusable patterns and successful approaches.
 *
 * Unlike semantic memory (facts) and reflexion (lessons), procedural memory
 * focuses on "how to do things" - workflows, code patterns, debugging approaches.
 *
 * Categories:
 * - code: Reusable code patterns, idioms, templates
 * - workflow: Processes for completing tasks
 * - debugging: Approaches to finding and fixing bugs
 * - testing: Testing strategies and patterns
 * - documentation: Documentation patterns
 */
export class ProceduralMemoryPlugin implements Plugin {
    name = 'ProceduralMemoryPlugin';

    private writer?: UIMessageStreamWriter<VibesUIMessage>;
    private model?: LanguageModel;
    private config: Required<ProceduralMemoryConfig>;
    private patterns: Map<string, Pattern> = new Map();

    constructor(
        model?: LanguageModel,
        config: ProceduralMemoryConfig = {}
    ) {
        this.model = model;
        this.config = {
            maxPatterns: config.maxPatterns || 50,
            patternsPath: config.patternsPath || 'workspace/patterns.json',
            autoSuggest: config.autoSuggest ?? true,
        };
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.writer = writer;
    }

    /**
     * Get all patterns
     */
    getPatterns(): Pattern[] {
        return Array.from(this.patterns.values());
    }

    /**
     * Get patterns by category
     */
    getPatternsByCategory(category: Pattern['category']): Pattern[] {
        return this.getPatterns().filter(p => p.category === category);
    }

    /**
     * Find relevant patterns for a context
     */
    findRelevantPatterns(context: string, limit: number = 5): Pattern[] {
        const contextLower = context.toLowerCase();
        const words = new Set(
            contextLower.split(/\s+/).filter(w => w.length > 3)
        );

        const scored = this.getPatterns().map(pattern => {
            let score = 0;
            const patternText = `${pattern.name} ${pattern.description} ${pattern.whenToUse} ${pattern.tags.join(' ')}`.toLowerCase();

            // Check if context directly mentions pattern name or tags
            if (contextLower.includes(pattern.name.toLowerCase())) {
                score += 5;
            }

            // Keyword matching
            for (const word of words) {
                if (patternText.includes(word)) score += 1;
            }

            // Boost highly-applied patterns
            score += Math.min(pattern.applicationCount, 3);

            // Boost high-success patterns
            if (pattern.successRate !== undefined) {
                score += pattern.successRate * 2;
            }

            return { pattern, score };
        });

        return scored
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(s => s.pattern);
    }

    /**
     * Tools provided by the procedural memory plugin
     */
    get tools() {
        return {
            save_pattern: tool({
                description: `Save a reusable pattern or successful approach to procedural memory.
Use this when you discover an effective way to solve a problem that could be reused later.`,
                inputSchema: z.object({
                    name: z.string().describe('Short, memorable name for the pattern'),
                    description: z.string().describe('Description of what this pattern does'),
                    whenToUse: z.string().describe('When this pattern should be applied (conditions, situations)'),
                    steps: z.array(z.string()).describe('Steps to follow when applying this pattern'),
                    example: z.string().optional().describe('Example of the pattern in action'),
                    category: z.enum(['code', 'workflow', 'debugging', 'testing', 'documentation']).default('workflow'),
                    tags: z.array(z.string()).optional().describe('Tags for retrieval'),
                    fileReferences: z.array(z.string()).optional().describe('Related file paths'),
                    urlReferences: z.array(z.string()).optional().describe('Related documentation URLs'),
                }),
                execute: async ({ name, description, whenToUse, steps, example, category, tags, fileReferences, urlReferences }) => {
                    const now = new Date().toISOString();
                    const newPattern: Pattern = {
                        id: `pattern_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
                        name,
                        description,
                        whenToUse,
                        steps,
                        example,
                        category,
                        tags: tags || [],
                        timestamp: now,
                        applicationCount: 0,
                        fileReferences,
                        urlReferences,
                    };

                    this.patterns.set(newPattern.id, newPattern);

                    // Trim if over limit
                    if (this.patterns.size > this.config.maxPatterns) {
                        const all = this.getPatterns();
                        // Remove least applied patterns
                        const toRemove = all
                            .sort((a, b) => a.applicationCount - b.applicationCount)
                            .slice(0, all.length - this.config.maxPatterns);
                        for (const p of toRemove) {
                            this.patterns.delete(p.id);
                        }
                    }

                    await this.persistPatterns();

                    this.notifyStatus(`Pattern saved: ${name}`);

                    return {
                        success: true,
                        patternId: newPattern.id,
                        message: `Pattern "${name}" saved to procedural memory`,
                    };
                },
            }),

            get_patterns: tool({
                description: `Retrieve relevant patterns for the current context.
Use this when starting a task to see if there's a known pattern that applies.`,
                inputSchema: z.object({
                    context: z.string().describe('Current task context for pattern matching'),
                    category: z.enum(['code', 'workflow', 'debugging', 'testing', 'documentation']).optional().describe('Filter by category'),
                    limit: z.number().default(5).describe('Maximum patterns to return'),
                }),
                execute: async ({ context, category, limit, }) => {
                    let relevant = this.findRelevantPatterns(context, limit);

                    if (category) {
                        relevant = relevant.filter(p => p.category === category);
                    }

                    return {
                        success: true,
                        patterns: relevant.map(p => ({
                            id: p.id,
                            name: p.name,
                            description: p.description,
                            whenToUse: p.whenToUse,
                            steps: p.steps,
                            category: p.category,
                            applicationCount: p.applicationCount,
                            successRate: p.successRate,
                        })),
                        count: relevant.length,
                        message: `Found ${relevant.length} relevant pattern${relevant.length !== 1 ? 's' : ''}`,
                    };
                },
            }),

            apply_pattern: tool({
                description: `Apply a stored pattern to the current task.
Use this after retrieving a pattern to track its usage and success rate.`,
                inputSchema: z.object({
                    patternId: z.string().describe('ID of the pattern to apply'),
                    notes: z.string().optional().describe('Notes about how the pattern was applied or modified'),
                    success: z.boolean().default(true).describe('Whether applying the pattern was successful'),
                }),
                execute: async ({ patternId, notes, success }) => {
                    const pattern = this.patterns.get(patternId);
                    if (!pattern) {
                        return {
                            success: false,
                            error: `Pattern not found: ${patternId}`,
                        };
                    }

                    const now = new Date().toISOString();
                    pattern.applicationCount++;
                    pattern.lastApplied = now;

                    // Update success tracking
                    if (success) {
                        pattern.successCount = (pattern.successCount || 0) + 1;
                    } else {
                        pattern.failureCount = (pattern.failureCount || 0) + 1;
                    }

                    // Calculate success rate
                    const total = (pattern.successCount || 0) + (pattern.failureCount || 0);
                    if (total > 0) {
                        pattern.successRate = (pattern.successCount || 0) / total;
                    }

                    await this.persistPatterns();

                    this.notifyStatus(`Pattern applied: ${pattern.name} (used ${pattern.applicationCount}x, success rate: ${Math.round((pattern.successRate || 0) * 100)}%)`);

                    return {
                        success: true,
                        pattern,
                        message: `Pattern "${pattern.name}" marked as applied`,
                    };
                },
            }),

            list_patterns: tool({
                description: `List all stored patterns, optionally filtered by category.
Use this to review all patterns in procedural memory.`,
                inputSchema: z.object({
                    category: z.enum(['code', 'workflow', 'debugging', 'testing', 'documentation']).optional(),
                    limit: z.number().default(20).describe('Maximum patterns to return'),
                }),
                execute: async ({ category, limit }) => {
                    let patterns = this.getPatterns();

                    if (category) {
                        patterns = patterns.filter(p => p.category === category);
                    }

                    const limited = patterns.slice(0, limit);

                    // Group by category for display
                    const byCategory: Record<string, Pattern[]> = {
                        code: [],
                        workflow: [],
                        debugging: [],
                        testing: [],
                        documentation: [],
                    };

                    for (const pattern of patterns) {
                        byCategory[pattern.category].push(pattern);
                    }

                    return {
                        success: true,
                        patterns: limited.map(p => ({
                            id: p.id,
                            name: p.name,
                            description: p.description,
                            category: p.category,
                            applicationCount: p.applicationCount,
                            successRate: p.successRate,
                        })),
                        byCategory,
                        count: limited.length,
                        total: patterns.length,
                        message: category
                            ? `${limited.length} patterns in category: ${category}`
                            : `Showing ${limited.length} of ${patterns.length} total patterns`,
                    };
                },
            }),

            update_pattern: tool({
                description: `Update an existing pattern's content or metadata.`,
                inputSchema: z.object({
                    patternId: z.string(),
                    name: z.string().optional(),
                    description: z.string().optional(),
                    whenToUse: z.string().optional(),
                    steps: z.array(z.string()).optional(),
                    tags: z.array(z.string()).optional(),
                }),
                execute: async ({ patternId, name, description, whenToUse, steps, tags }) => {
                    const existing = this.patterns.get(patternId);
                    if (!existing) {
                        return {
                            success: false,
                            error: `Pattern not found: ${patternId}`,
                        };
                    }

                    const updated: Pattern = {
                        ...existing,
                        name: name || existing.name,
                        description: description || existing.description,
                        whenToUse: whenToUse || existing.whenToUse,
                        steps: steps || existing.steps,
                        tags: tags || existing.tags,
                    };

                    this.patterns.set(patternId, updated);
                    await this.persistPatterns();

                    return {
                        success: true,
                        pattern: updated,
                        message: `Pattern "${updated.name}" updated`,
                    };
                },
            }),

            delete_pattern: tool({
                description: `Remove a pattern from procedural memory.
Use this when a pattern becomes obsolete or incorrect.`,
                inputSchema: z.object({
                    patternId: z.string().describe('ID of the pattern to delete'),
                }),
                execute: async ({ patternId }) => {
                    const pattern = this.patterns.get(patternId);
                    if (!pattern) {
                        return {
                            success: false,
                            error: `Pattern not found: ${patternId}`,
                        };
                    }

                    this.patterns.delete(patternId);
                    await this.persistPatterns();

                    this.notifyStatus(`Pattern deleted: ${pattern.name}`);

                    return {
                        success: true,
                        message: `Pattern "${pattern.name}" removed`,
                    };
                },
            }),

            extract_patterns: tool({
                description: `Extract reusable patterns from a completed task or successful outcome.
Use this to identify and store patterns from experience.`,
                inputSchema: z.object({
                    taskDescription: z.string().describe('The task that was completed'),
                    approachTaken: z.string().describe('The approach or steps that worked well'),
                    context: z.string().optional().describe('Additional context about when this applies'),
                    category: z.enum(['code', 'workflow', 'debugging', 'testing', 'documentation']).optional(),
                }),
                execute: async ({ taskDescription, approachTaken, context, category }) => {
                    if (!this.model) {
                        // Simple extraction without AI
                        const newPattern: Pattern = {
                            id: `pattern_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
                            name: taskDescription.slice(0, 50),
                            description: approachTaken.slice(0, 200),
                            whenToUse: context || 'When similar tasks arise',
                            steps: approachTaken.split('\n').filter(s => s.trim()),
                            category: category || 'workflow',
                            tags: ['extracted'],
                            timestamp: new Date().toISOString(),
                            applicationCount: 1, // Count as already applied once
                            successCount: 1,
                            failureCount: 0,
                            successRate: 1,
                        };

                        this.patterns.set(newPattern.id, newPattern);
                        await this.persistPatterns();

                        return {
                            success: true,
                            pattern: newPattern,
                            message: `Pattern extracted and stored`,
                        };
                    }

                    // Use AI to extract structured pattern
                    try {
                        const { text } = await generateText({
                            model: this.model,
                            system: `You are an expert at identifying reusable patterns from successful work.
Extract a structured pattern including name, description, when to use it, and specific steps.

Output ONLY valid JSON:
\`\`\`
{
  "name": "Pattern Name",
  "description": "Brief description",
  "whenToUse": "When to apply this pattern",
  "steps": ["Step 1", "Step 2", "Step 3"],
  "tags": ["tag1", "tag2"]
}
\`\`\``,
                            prompt: `Extract a reusable pattern from this successful work:

Task: ${taskDescription}

Approach that worked: ${approachTaken}

${context ? `Context: ${context}` : ''}`,
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
                                error: `Failed to parse pattern: ${e}`,
                            };
                        }

                        const newPattern: Pattern = {
                            id: `pattern_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
                            name: data.name || taskDescription.slice(0, 50),
                            description: data.description || approachTaken.slice(0, 200),
                            whenToUse: data.whenToUse || context || 'When similar tasks arise',
                            steps: data.steps || approachTaken.split('\n').filter(s => s.trim()),
                            category: category || 'workflow',
                            tags: data.tags || ['extracted'],
                            timestamp: new Date().toISOString(),
                            applicationCount: 0,
                        };

                        this.patterns.set(newPattern.id, newPattern);
                        await this.persistPatterns();

                        this.notifyStatus(`Pattern extracted: ${newPattern.name}`);

                        return {
                            success: true,
                            pattern: newPattern,
                            message: `Pattern extracted and stored`,
                        };
                    } catch (e) {
                        return {
                            success: false,
                            error: `Pattern extraction failed: ${e}`,
                        };
                    }
                },
            }),
        };
    }

    /**
     * Modify system prompt to suggest relevant patterns
     */
    modifySystemPrompt(prompt: string): string | Promise<string> {
        if (this.patterns.size === 0 || !this.config.autoSuggest) {
            return prompt;
        }

        // Get top patterns by application count
        const topPatterns = [...this.patterns.values()]
            .sort((a, b) => b.applicationCount - a.applicationCount)
            .slice(0, 3);

        if (topPatterns.length === 0) {
            return prompt;
        }

        let patternsSection = '\n\n## Procedural Memory\n\n';
        patternsSection += `You have stored ${this.patterns.size} pattern${this.patterns.size !== 1 ? 's' : '. '} `;
        patternsSection += `Use \`get_patterns(context)\` to find relevant patterns for your current task.\n\n`;

        patternsSection += `**Most Used Patterns:**\n`;
        for (const pattern of topPatterns) {
            const successRate = pattern.successRate !== undefined
                ? ` (${Math.round(pattern.successRate * 100)}% success rate)`
                : '';
            patternsSection += `- **${pattern.name}**: ${pattern.description} [${pattern.category}]${successRate}\n`;
        }

        return prompt + patternsSection;
    }

    /**
     * Persist patterns to file
     */
    private async persistPatterns(): Promise<void> {
        try {
            const fs = await import('fs/promises');
            const pathModule = await import('path');
            const fullPath = pathModule.resolve(process.cwd(), this.config.patternsPath);

            await fs.mkdir(pathModule.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, JSON.stringify(Array.from(this.patterns.values()), null, 2));
        } catch (e) {
            console.error('Failed to persist patterns:', e);
        }
    }

    /**
     * Load patterns from file
     */
    private async loadPatterns(): Promise<void> {
        try {
            const fs = await import('fs/promises');
            const pathModule = await import('path');
            const fullPath = pathModule.resolve(process.cwd(), this.config.patternsPath);

            const content = await fs.readFile(fullPath, 'utf-8');
            const loaded = JSON.parse(content) as Pattern[];

            for (const pattern of loaded) {
                this.patterns.set(pattern.id, pattern);
            }
        } catch (e) {
            // File doesn't exist or is invalid - start fresh
            this.patterns.clear();
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
     * Initialization: load existing patterns
     */
    async waitReady(): Promise<void> {
        await this.loadPatterns();
    }
}

export default ProceduralMemoryPlugin;
