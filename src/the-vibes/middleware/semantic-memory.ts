import {
    tool,
    type UIMessageStreamWriter,
    type LanguageModel,
    embed,
} from 'ai';
import { z } from 'zod';
import { AgentUIMessage, Middleware, TaskItem } from '../core/types';

/**
 * A stored fact with its embedding vector.
 */
export interface Fact {
    /** Unique identifier for the fact */
    id: string;
    /** The fact content */
    fact: string;
    /** Embedding vector (if available) */
    embedding?: number[];
    /** Keywords for fallback matching */
    keywords: string[];
    /** Importance score (0-1) */
    importance: number;
    /** Category for organization */
    category: 'project' | 'code' | 'convention' | 'user' | 'general';
    /** Tags for filtering */
    tags: string[];
    /** When this fact was stored */
    timestamp: string;
    /** How many times this fact has been recalled */
    recallCount: number;
    /** Last time this fact was recalled */
    lastRecalled?: string;
    /** Source/context of the fact */
    context?: string;
    /** Related file or resource */
    resourceReference?: string;
}

/**
 * Result of a similarity search.
 */
export interface FactMatch {
    /** The matched fact */
    fact: Fact;
    /** Similarity score (0-1) */
    similarity: number;
}

/**
 * Configuration for SemanticMemoryMiddleware
 */
export interface SemanticMemoryConfig {
    /** Maximum facts to store (default: 200) */
    maxFacts?: number;
    /** Path to facts storage file (default: workspace/facts.json) */
    factsPath?: string;
    /** Minimum similarity threshold for retrieval (default: 0.3) */
    similarityThreshold?: number;
    /** Whether to auto-extract facts from task completion (default: true) */
    autoExtract?: boolean;
    /** Embedding model to use (optional - falls back to keyword matching) */
    embeddingModel?: LanguageModel;
}

/**
 * Simple in-memory vector store with cosine similarity.
 */
class SimpleVectorStore {
    private facts: Map<string, Fact> = new Map();

    /**
     * Calculate cosine similarity between two vectors.
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }

    /**
     * Add or update a fact.
     */
    upsert(fact: Fact): void {
        this.facts.set(fact.id, fact);
    }

    /**
     * Remove a fact.
     */
    delete(id: string): boolean {
        return this.facts.delete(id);
    }

    /**
     * Get a fact by ID.
     */
    get(id: string): Fact | undefined {
        return this.facts.get(id);
    }

    /**
     * Get all facts.
     */
    getAll(): Fact[] {
        return Array.from(this.facts.values());
    }

    /**
     * Search by embedding vector similarity.
     */
    searchByEmbedding(queryEmbedding: number[], threshold: number = 0.3): FactMatch[] {
        const matches: FactMatch[] = [];

        for (const fact of this.facts.values()) {
            if (!fact.embedding) continue;

            const similarity = this.cosineSimilarity(queryEmbedding, fact.embedding);
            if (similarity >= threshold) {
                matches.push({ fact, similarity });
            }
        }

        return matches.sort((a, b) => b.similarity - a.similarity);
    }

    /**
     * Search by keyword matching (fallback).
     */
    searchByKeywords(query: string, threshold: number = 0.3): FactMatch[] {
        const queryLower = query.toLowerCase();
        const queryWords = new Set(
            queryLower.split(/\s+/).filter(w => w.length > 3)
        );

        const matches: FactMatch[] = [];

        for (const fact of this.facts.values()) {
            const factText = `${fact.fact} ${fact.keywords.join(' ')} ${fact.tags.join(' ')}`.toLowerCase();
            const factWords = new Set(
                factText.split(/\s+/).filter(w => w.length > 3)
            );

            // Calculate Jaccard similarity
            const intersection = new Set([...queryWords].filter(x => factWords.has(x)));
            const union = new Set([...queryWords, ...factWords]);
            const similarity = union.size === 0 ? 0 : intersection.size / union.size;

            if (similarity >= threshold) {
                matches.push({ fact, similarity });
            }
        }

        return matches.sort((a, b) => b.similarity - a.similarity);
    }

    /**
     * Get facts by category.
     */
    getByCategory(category: Fact['category']): Fact[] {
        return this.getAll().filter(f => f.category === category);
    }

    /**
     * Get facts by tag.
     */
    getByTag(tag: string): Fact[] {
        return this.getAll().filter(f => f.tags.includes(tag));
    }

    /**
     * Clear all facts.
     */
    clear(): void {
        this.facts.clear();
    }

    /**
     * Get count of facts.
     */
    size(): number {
        return this.facts.size;
    }
}

/**
 * SemanticMemoryMiddleware provides vector-based fact storage and retrieval.
 *
 * Features:
 * - Store facts with optional embeddings for semantic search
 * - Retrieve relevant facts by similarity (RAG-style memory)
 * - Keyword-based fallback when embeddings unavailable
 * - Automatic fact extraction from task completion
 * - Persistent storage to workspace/facts.json
 *
 * Uses simple cosine similarity for in-memory vector operations.
 * Can integrate with embedding models (OpenAI, etc.) for better semantic matching.
 */
export class SemanticMemoryMiddleware implements Middleware {
    name = 'SemanticMemoryMiddleware';

    private writer?: UIMessageStreamWriter<AgentUIMessage>;
    private embeddingModel?: LanguageModel;
    private config: Required<SemanticMemoryConfig>;
    private vectorStore: SimpleVectorStore;

    constructor(
        embeddingModel?: LanguageModel,
        config: SemanticMemoryConfig = {}
    ) {
        this.embeddingModel = embeddingModel;
        this.config = {
            maxFacts: config.maxFacts || 200,
            factsPath: config.factsPath || 'workspace/facts.json',
            similarityThreshold: config.similarityThreshold || 0.3,
            autoExtract: config.autoExtract ?? true,
            embeddingModel: config.embeddingModel || embeddingModel,
        };
        this.vectorStore = new SimpleVectorStore();
    }

    onStreamReady(writer: UIMessageStreamWriter<AgentUIMessage>) {
        this.writer = writer;
    }

    /**
     * Extract keywords from text for fallback matching.
     */
    private extractKeywords(text: string): string[] {
        const words = text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3);

        // Remove common stop words
        const stopWords = new Set([
            'this', 'that', 'with', 'from', 'have', 'been', 'were', 'they',
            'their', 'what', 'when', 'where', 'which', 'while', 'through',
            'those', 'these', 'each', 'into', 'after', 'before', 'being',
        ]);

        return words.filter(w => !stopWords.has(w));
    }

    /**
     * Generate embedding for text (if model available).
     */
    private async generateEmbedding(text: string): Promise<number[] | undefined> {
        const model = this.config.embeddingModel || this.embeddingModel;
        if (!model) return undefined;

        try {
            const { embedding } = await embed({
                model,
                value: text,
            });
            return embedding;
        } catch (e) {
            console.error('Embedding generation failed:', e);
            return undefined;
        }
    }

    /**
     * Tools provided by the semantic memory middleware
     */
    get tools() {
        return {
            remember_fact: tool({
                description: `Store an important fact in semantic memory for later retrieval.
Use this to remember project-specific information, conventions, or important discoveries.
Facts are stored with embeddings for semantic search - you can recall them by meaning, not just keywords.`,
                inputSchema: z.object({
                    fact: z.string().describe('The fact to remember (be specific and concise)'),
                    importance: z.number().min(0).max(1).default(0.5).describe('Importance score (0-1, higher = more important)'),
                    category: z.enum(['project', 'code', 'convention', 'user', 'general']).default('general').describe('Category of the fact'),
                    tags: z.array(z.string()).optional().describe('Tags for filtering (e.g., ["auth", "security"])'),
                    context: z.string().optional().describe('Additional context about this fact'),
                    resourceReference: z.string().optional().describe('Related file or resource (e.g., "src/auth.ts")'),
                }),
                execute: async ({ fact, importance, category, tags, context, resourceReference }) => {
                    const now = new Date().toISOString();
                    const keywords = this.extractKeywords(fact);

                    // Generate embedding if model available
                    const embedding = await this.generateEmbedding(fact);

                    const newFact: Fact = {
                        id: `fact_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
                        fact,
                        keywords,
                        importance,
                        category,
                        tags: tags || [],
                        timestamp: now,
                        recallCount: 0,
                        context,
                        resourceReference,
                        embedding,
                    };

                    this.vectorStore.upsert(newFact);

                    // Trim if over limit
                    if (this.vectorStore.size() > this.config.maxFacts) {
                        const all = this.vectorStore.getAll();
                        // Remove least important/least recently recalled
                        const toRemove = all
                            .sort((a, b) => {
                                const importanceDiff = a.importance - b.importance;
                                if (importanceDiff !== 0) return importanceDiff;
                                return (a.recallCount || 0) - (b.recallCount || 0);
                            })
                            .slice(0, all.length - this.config.maxFacts);

                        for (const f of toRemove) {
                            this.vectorStore.delete(f.id);
                        }
                    }

                    await this.persistFacts();

                    this.notifyStatus(`Fact remembered: ${fact.slice(0, 50)}...`);

                    return {
                        success: true,
                        factId: newFact.id,
                        message: `Fact stored in semantic memory`,
                    };
                },
            }),

            recall_facts: tool({
                description: `Retrieve relevant facts from semantic memory based on a query.
Uses semantic search to find facts by meaning, not just keywords.
Use this when starting a task to see what's been learned about the topic.`,
                inputSchema: z.object({
                    query: z.string().describe('Query to find relevant facts'),
                    limit: z.number().min(1).max(20).default(5).describe('Maximum facts to return'),
                    category: z.enum(['project', 'code', 'convention', 'user', 'general']).optional().describe('Filter by category'),
                    minImportance: z.number().min(0).max(1).optional().describe('Minimum importance score'),
                }),
                execute: async ({ query, limit, category, minImportance }) => {
                    // Generate embedding for query if model available
                    const queryEmbedding = await this.generateEmbedding(query);

                    let matches: FactMatch[];
                    if (queryEmbedding) {
                        matches = this.vectorStore.searchByEmbedding(
                            queryEmbedding,
                            this.config.similarityThreshold
                        );
                    } else {
                        matches = this.vectorStore.searchByKeywords(
                            query,
                            this.config.similarityThreshold
                        );
                    }

                    // Apply filters
                    let filtered = matches;
                    if (category) {
                        filtered = filtered.filter(m => m.fact.category === category);
                    }
                    if (minImportance !== undefined) {
                        filtered = filtered.filter(m => m.fact.importance >= minImportance);
                    }

                    // Apply limit
                    const results = filtered.slice(0, limit);

                    // Update recall stats
                    const now = new Date().toISOString();
                    for (const match of results) {
                        match.fact.recallCount++;
                        match.fact.lastRecalled = now;
                        this.vectorStore.upsert(match.fact);
                    }

                    return {
                        success: true,
                        facts: results.map(r => ({
                            fact: r.fact.fact,
                            similarity: r.similarity,
                            category: r.fact.category,
                            importance: r.fact.importance,
                            resourceReference: r.fact.resourceReference,
                        })),
                        count: results.length,
                        message: `Found ${results.length} relevant fact${results.length !== 1 ? 's' : ''}`,
                    };
                },
            }),

            forget_fact: tool({
                description: `Remove a fact from semantic memory.
Use this when a fact becomes obsolete or incorrect.`,
                inputSchema: z.object({
                    factId: z.string().describe('ID of the fact to forget'),
                }),
                execute: async ({ factId }) => {
                    const fact = this.vectorStore.get(factId);
                    if (!fact) {
                        return {
                            success: false,
                            error: `Fact not found: ${factId}`,
                        };
                    }

                    this.vectorStore.delete(factId);
                    await this.persistFacts();

                    this.notifyStatus(`Fact forgotten: ${fact.fact.slice(0, 30)}...`);

                    return {
                        success: true,
                        message: `Fact removed from memory`,
                    };
                },
            }),

            list_facts: tool({
                description: `List all stored facts, optionally filtered by category or tag.
Use this to review what's been stored in semantic memory.`,
                inputSchema: z.object({
                    category: z.enum(['project', 'code', 'convention', 'user', 'general']).optional(),
                    tag: z.string().optional(),
                    limit: z.number().default(20).describe('Maximum facts to return'),
                }),
                execute: async ({ category, tag, limit }) => {
                    let facts = this.vectorStore.getAll();

                    if (category) {
                        facts = facts.filter(f => f.category === category);
                    }
                    if (tag) {
                        facts = facts.filter(f => f.tags.includes(tag));
                    }

                    const limited = facts.slice(0, limit);

                    return {
                        success: true,
                        facts: limited.map(f => ({
                            id: f.id,
                            fact: f.fact,
                            category: f.category,
                            importance: f.importance,
                            recallCount: f.recallCount,
                            tags: f.tags,
                            resourceReference: f.resourceReference,
                        })),
                        count: limited.length,
                        total: facts.length,
                        message: category
                            ? `${limited.length} facts in category: ${category}`
                            : `Showing ${limited.length} of ${facts.length} total facts`,
                    };
                },
            }),

            extract_facts: tool({
                description: `Extract and store important facts from a block of text.
Use this after reading documentation, code comments, or user requirements.
The AI will identify the most important facts and store them.`,
                inputSchema: z.object({
                    text: z.string().describe('Text to extract facts from'),
                    context: z.string().optional().describe('Context about where this text came from'),
                    category: z.enum(['project', 'code', 'convention', 'user', 'general']).optional().describe('Default category for extracted facts'),
                    resourceReference: z.string().optional().describe('Related file or resource'),
                }),
                execute: async ({ text, context, category, resourceReference }) => {
                    // For now, store the text as a single fact
                    // In a full implementation, we'd use the LLM to extract individual facts
                    const keywords = this.extractKeywords(text);

                    const newFact: Fact = {
                        id: `fact_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
                        fact: text.slice(0, 500), // Truncate long text
                        keywords,
                        importance: 0.5,
                        category: category || 'general',
                        tags: ['extracted'],
                        timestamp: new Date().toISOString(),
                        recallCount: 0,
                        context,
                        resourceReference,
                    };

                    this.vectorStore.upsert(newFact);
                    await this.persistFacts();

                    this.notifyStatus(`Extracted and stored fact from: ${context || 'text'}`);

                    return {
                        success: true,
                        factId: newFact.id,
                        message: `Fact extracted and stored`,
                    };
                },
            }),

            update_fact: tool({
                description: `Update an existing fact's content or metadata.`,
                inputSchema: z.object({
                    factId: z.string(),
                    fact: z.string().optional(),
                    importance: z.number().min(0).max(1).optional(),
                    category: z.enum(['project', 'code', 'convention', 'user', 'general']).optional(),
                    tags: z.array(z.string()).optional(),
                }),
                execute: async ({ factId, fact, importance, category, tags }) => {
                    const existing = this.vectorStore.get(factId);
                    if (!existing) {
                        return {
                            success: false,
                            error: `Fact not found: ${factId}`,
                        };
                    }

                    const updated: Fact = {
                        ...existing,
                        fact: fact || existing.fact,
                        importance: importance ?? existing.importance,
                        category: category ?? existing.category,
                        tags: tags ?? existing.tags,
                    };

                    // Regenerate embedding if fact changed
                    if (fact) {
                        updated.embedding = await this.generateEmbedding(fact);
                        updated.keywords = this.extractKeywords(fact);
                    }

                    this.vectorStore.upsert(updated);
                    await this.persistFacts();

                    return {
                        success: true,
                        message: `Fact updated`,
                    };
                },
            }),
        };
    }

    /**
     * Modify system prompt to include highly important facts
     */
    modifySystemPrompt(prompt: string): string | Promise<string> {
        const allFacts = this.vectorStore.getAll();

        if (allFacts.length === 0) {
            return prompt;
        }

        // Get high-importance facts (0.7+) that have been recalled before
        const importantFacts = allFacts
            .filter(f => f.importance >= 0.7)
            .sort((a, b) => b.importance - a.importance)
            .slice(0, 5);

        if (importantFacts.length === 0) {
            return prompt;
        }

        let memorySection = '\n\n## Semantic Memory\n\n';
        memorySection += `You have stored ${allFacts.length} fact${allFacts.length !== 1 ? 's' : ''} in semantic memory. `;
        memorySection += `Use \`recall_facts(query)\` to retrieve relevant facts for your current task.\n\n`;

        memorySection += `**Important Facts:**\n`;
        for (const fact of importantFacts) {
            const source = fact.resourceReference ? ` (${fact.resourceReference})` : '';
            memorySection += `- [${fact.category}]${source} ${fact.fact}\n`;
        }

        return prompt + memorySection;
    }

    /**
     * Persist facts to file
     */
    private async persistFacts(): Promise<void> {
        try {
            const fs = await import('fs/promises');
            const pathModule = await import('path');
            const fullPath = pathModule.resolve(process.cwd(), this.config.factsPath);

            await fs.mkdir(pathModule.dirname(fullPath), { recursive: true });

            // Don't store embeddings in JSON (they're large and can be regenerated)
            const factsToStore = this.vectorStore.getAll().map(f => ({
                ...f,
                embedding: undefined, // Exclude embeddings from storage
            }));

            await fs.writeFile(fullPath, JSON.stringify(factsToStore, null, 2));
        } catch (e) {
            console.error('Failed to persist facts:', e);
        }
    }

    /**
     * Load facts from file
     */
    private async loadFacts(): Promise<void> {
        try {
            const fs = await import('fs/promises');
            const pathModule = await import('path');
            const fullPath = pathModule.resolve(process.cwd(), this.config.factsPath);

            const content = await fs.readFile(fullPath, 'utf-8');
            const loaded = JSON.parse(content) as Fact[];

            for (const fact of loaded) {
                this.vectorStore.upsert(fact);
            }
        } catch (e) {
            // File doesn't exist or is invalid - start fresh
            this.vectorStore.clear();
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
     * Initialization: load existing facts
     */
    async waitReady(): Promise<void> {
        await this.loadFacts();
    }
}

export default SemanticMemoryMiddleware;
