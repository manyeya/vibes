import { tool, type UIMessageStreamWriter } from "ai";
import {
    Plugin,
    PluginStreamContext,
    VibesUIMessage,
    createDataStreamWriter,
    type DataStreamWriter,
} from "../core/types";
import * as fs from "fs/promises";
import * as path from "path";
import z from "zod";

interface MemoryNote {
    id: string;
    title: string;
    content: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
}

const MAX_INDEX_NOTES = 40; // how many note headers to surface in the prompt

/**
 * Persistent working memory for the agent — the one memory system in the stack.
 *
 * Two layers:
 *  1. **Scratchpad** — a single mutable "working notes" file, injected into the
 *     system prompt in full each turn. Use it for the current plan / state.
 *  2. **Long-term notes** — a searchable JSON store of discrete memories the
 *     agent explicitly saves (`remember`) and retrieves (`recall`). Only a
 *     compact index (id + title + tags) is injected into the prompt, so it
 *     stays useful without bloating context as it grows; full content is pulled
 *     on demand via `recall`.
 *
 * Loading happens inside the (async) `modifySystemPrompt`, so it always
 * reflects what's on disk at the start of each turn — no dependence on the
 * removed `beforeModel` hook. Node `fs` only (no Bun-specific APIs).
 */
export default class MemoryPlugin implements Plugin {
    name = 'MemoryPlugin';

    private writer?: DataStreamWriter;
    private streamContext?: PluginStreamContext;
    private readonly scratchpadPath: string;
    private readonly notesPath: string;
    private readonly maxNotes: number;

    constructor(config: { scratchpadPath?: string; notesPath?: string; reflexionPath?: string; maxNotes?: number } = {}) {
        this.scratchpadPath = config.scratchpadPath || 'workspace/scratchpad.md';
        // `reflexionPath` kept as a back-compat alias for the long-term store.
        this.notesPath = config.notesPath || config.reflexionPath?.replace(/\.md$/, '.json') || 'workspace/memories.json';
        this.maxNotes = config.maxNotes ?? 200;
    }

    onStreamContextReady(context: PluginStreamContext) {
        this.streamContext = context;
        this.writer = context.writer.withDefaults({ plugin: this.name });
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.streamContext = undefined;
        this.writer = createDataStreamWriter(writer).withDefaults({ plugin: this.name });
    }

    async waitReady() {
        await Promise.all([
            fs.mkdir(path.dirname(this.resolve(this.scratchpadPath)), { recursive: true }).catch(() => {}),
            fs.mkdir(path.dirname(this.resolve(this.notesPath)), { recursive: true }).catch(() => {}),
        ]);
    }

    // ── storage helpers ──────────────────────────────────────────────────────

    private resolve(p: string): string {
        return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    }

    private async ensureDir(filePath: string): Promise<void> {
        await fs.mkdir(path.dirname(this.resolve(filePath)), { recursive: true }).catch(() => {});
    }

    private async readScratchpad(): Promise<string> {
        try {
            return await fs.readFile(this.resolve(this.scratchpadPath), 'utf8');
        } catch {
            return '';
        }
    }

    private async writeScratchpad(content: string): Promise<void> {
        await this.ensureDir(this.scratchpadPath);
        await fs.writeFile(this.resolve(this.scratchpadPath), content, 'utf8');
    }

    private async readNotes(): Promise<MemoryNote[]> {
        try {
            const raw = await fs.readFile(this.resolve(this.notesPath), 'utf8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as MemoryNote[]) : [];
        } catch {
            return [];
        }
    }

    private async writeNotes(notes: MemoryNote[]): Promise<void> {
        await this.ensureDir(this.notesPath);
        // Cap growth: keep the most-recently-updated notes.
        const capped = [...notes]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, this.maxNotes);
        await fs.writeFile(this.resolve(this.notesPath), JSON.stringify(capped, null, 2), 'utf8');
    }

    /** Cheap keyword scoring — no embeddings. Counts query-token hits across
     *  title (weighted), tags (weighted) and content. */
    private static score(note: MemoryNote, tokens: string[]): number {
        if (tokens.length === 0) return 1; // empty query → everything matches (recency-sorted)
        const title = note.title.toLowerCase();
        const tags = note.tags.join(' ').toLowerCase();
        const content = note.content.toLowerCase();
        let s = 0;
        for (const t of tokens) {
            if (title.includes(t)) s += 3;
            if (tags.includes(t)) s += 2;
            if (content.includes(t)) s += 1;
        }
        return s;
    }

    // ── tools ────────────────────────────────────────────────────────────────

    get tools() {
        return {
            update_scratchpad: tool({
                description:
                    'Overwrite your scratchpad — your live working notes (current plan, open questions, ' +
                    'state). It is always shown to you in full in the system prompt. Use it for the ' +
                    '"what am I doing right now" picture; pass the COMPLETE new content (it replaces the old).',
                inputSchema: z.object({
                    content: z.string().describe('The full new scratchpad content.'),
                }),
                execute: async ({ content }) => {
                    const op = this.streamContext?.createOperation({ name: 'update-scratchpad', toolName: 'update_scratchpad', plugin: this.name, heartbeatEnabled: false });
                    await this.writeScratchpad(content);
                    op?.complete('Scratchpad updated', { phase: 'complete' });
                    this.writer?.writeMemoryUpdate('note', 'updated', undefined, { title: 'Scratchpad', detail: content.slice(0, 140) });
                    return { success: true, message: 'Scratchpad updated.' };
                },
            }),

            remember: tool({
                description:
                    'Save a discrete, reusable memory to long-term storage — a fact about the project/user, ' +
                    'a decision, a gotcha, a convention. Persists across sessions. Retrieve later with recall(). ' +
                    'Keep each memory focused (one idea); use a clear title so you can find it.',
                inputSchema: z.object({
                    title: z.string().describe('Short, searchable title, e.g. "Auth uses JWT in src/auth".'),
                    content: z.string().describe('The thing to remember, in full.'),
                    tags: z.array(z.string()).optional().describe('Optional tags for retrieval, e.g. ["auth", "convention"].'),
                }),
                execute: async ({ title, content, tags }) => {
                    const op = this.streamContext?.createOperation({ name: 'remember', toolName: 'remember', plugin: this.name, heartbeatEnabled: false });
                    const notes = await this.readNotes();
                    const now = new Date().toISOString();
                    const note: MemoryNote = {
                        id: `mem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
                        title,
                        content,
                        tags: tags ?? [],
                        createdAt: now,
                        updatedAt: now,
                    };
                    notes.push(note);
                    await this.writeNotes(notes);
                    op?.complete(`Remembered “${title}”`, { phase: 'complete' });
                    this.writer?.writeMemoryUpdate('note', 'saved', notes.length, { title, detail: content.slice(0, 140) });
                    return { success: true, id: note.id, message: `Saved memory "${title}" (id ${note.id}).` };
                },
            }),

            recall: tool({
                description:
                    'Search your long-term memory and return the best-matching notes in full. Use a few ' +
                    'keywords. Call this when the prompt index shows a relevant memory, or when you need ' +
                    'project/user context you may have saved before.',
                inputSchema: z.object({
                    query: z.string().describe('Keywords to search for (matches titles, tags, content).'),
                    limit: z.number().int().min(1).max(20).optional().describe('Max notes to return (default 5).'),
                }),
                execute: async ({ query, limit }) => {
                    const notes = await this.readNotes();
                    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
                    const ranked = notes
                        .map((n) => ({ n, s: MemoryPlugin.score(n, tokens) }))
                        .filter((x) => x.s > 0)
                        .sort((a, b) => b.s - a.s || b.n.updatedAt.localeCompare(a.n.updatedAt))
                        .slice(0, limit ?? 5)
                        .map((x) => ({ id: x.n.id, title: x.n.title, content: x.n.content, tags: x.n.tags }));
                    this.writer?.writeStatus(`Recalled ${ranked.length} memor${ranked.length === 1 ? 'y' : 'ies'} for "${query}"`, undefined, undefined, { transient: true });
                    return { count: ranked.length, results: ranked };
                },
            }),

            update_memory: tool({
                description: 'Revise an existing long-term memory by id (replace content and/or title/tags).',
                inputSchema: z.object({
                    id: z.string().describe('The memory id (from remember/recall/list_memories).'),
                    content: z.string().optional(),
                    title: z.string().optional(),
                    tags: z.array(z.string()).optional(),
                }),
                execute: async ({ id, content, title, tags }) => {
                    const notes = await this.readNotes();
                    const note = notes.find((n) => n.id === id);
                    if (!note) return { success: false, message: `No memory with id ${id}. Use list_memories.` };
                    if (content !== undefined) note.content = content;
                    if (title !== undefined) note.title = title;
                    if (tags !== undefined) note.tags = tags;
                    note.updatedAt = new Date().toISOString();
                    await this.writeNotes(notes);
                    this.writer?.writeMemoryUpdate('note', 'updated', notes.length, { title: note.title, detail: note.content.slice(0, 140) });
                    return { success: true, id, message: `Updated memory "${note.title}".` };
                },
            }),

            forget: tool({
                description: 'Delete a long-term memory by id when it is wrong or no longer relevant.',
                inputSchema: z.object({
                    id: z.string().describe('The memory id to delete.'),
                }),
                execute: async ({ id }) => {
                    const notes = await this.readNotes();
                    const next = notes.filter((n) => n.id !== id);
                    if (next.length === notes.length) return { success: false, message: `No memory with id ${id}.` };
                    await this.writeNotes(next);
                    this.writer?.writeMemoryUpdate('note', 'deleted', next.length, { title: 'Memory forgotten' });
                    return { success: true, message: `Forgot memory ${id}.` };
                },
            }),

            list_memories: tool({
                description: 'List the headers (id, title, tags) of all stored long-term memories.',
                inputSchema: z.object({}),
                execute: async () => {
                    const notes = await this.readNotes();
                    return {
                        count: notes.length,
                        memories: notes
                            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                            .map((n) => ({ id: n.id, title: n.title, tags: n.tags })),
                    };
                },
            }),
        };
    }

    // ── prompt injection (async: loads from disk each turn) ────────────────────

    async modifySystemPrompt(prompt: string): Promise<string> {
        const [scratchpad, notes] = await Promise.all([this.readScratchpad(), this.readNotes()]);

        let section = '\n\n# Memory\n';
        section += '\n## Scratchpad (your live working notes — overwrite with `update_scratchpad`)\n';
        section += scratchpad.trim() ? scratchpad.trim() : '_(empty)_';

        const recent = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        section += `\n\n## Long-term memory — ${notes.length} note${notes.length === 1 ? '' : 's'}`;
        if (notes.length === 0) {
            section += '\n_(nothing saved yet — use `remember(title, content)` for things worth keeping across turns; `recall(query)` to read them back)_';
        } else {
            section += ' (call `recall("keywords")` to read one in full)\n';
            section += recent
                .slice(0, MAX_INDEX_NOTES)
                .map((n) => `- \`${n.id}\` ${n.title}${n.tags.length ? `  #${n.tags.join(' #')}` : ''}`)
                .join('\n');
            if (recent.length > MAX_INDEX_NOTES) {
                section += `\n- …and ${recent.length - MAX_INDEX_NOTES} more (use \`list_memories\` / \`recall\`)`;
            }
        }

        return prompt + section + '\n';
    }
}
