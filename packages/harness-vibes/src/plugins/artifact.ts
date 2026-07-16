import { tool } from "ai";
import z from "zod";
import * as path from "path";
import {
    VibesUIMessage,
    Plugin,
    PluginStreamContext,
    type DataStreamWriter,
} from "../core/types";
import { type Sandbox } from "../core/sandbox";
import { LocalSandbox } from "../sandbox/local-sandbox";

export type ArtifactKind = 'html' | 'markdown' | 'mermaid' | 'chart';

interface ArtifactRecord {
    id: string;
    title: string;
    kind: ArtifactKind;
    path: string;
    version: number;
    summary?: string;
}

export const EXT_BY_KIND: Record<ArtifactKind, string> = {
    html: 'html',
    markdown: 'md',
    mermaid: 'mmd',
    chart: 'json',
};

export const KIND_BY_EXT: Record<string, ArtifactKind> = {
    html: 'html',
    md: 'markdown',
    markdown: 'markdown',
    mmd: 'mermaid',
    json: 'chart',
};

export function slugify(input: string): string {
    return (
        input
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'artifact'
    );
}

/**
 * Validate a chart spec so the agent gets actionable feedback instead of a
 * silently-broken artifact. Mirrors what ChartView renders on the frontend.
 */
export function validateChartSpec(content: string): void {
    let spec: any;
    try {
        spec = JSON.parse(content);
    } catch (e) {
        throw new Error(
            `chart content must be valid JSON. Parse error: ${(e as Error).message}`,
        );
    }
    const types = ['bar', 'line', 'area', 'pie'];
    if (!spec || typeof spec !== 'object' || !types.includes(spec.type)) {
        throw new Error(`chart spec needs a "type" of one of: ${types.join(', ')}`);
    }
    const hasData = Array.isArray(spec.data) && spec.data.length > 0;
    const hasSeries = Array.isArray(spec.series) && spec.series.length > 0;
    if (!hasData && !hasSeries) {
        throw new Error('chart spec needs a non-empty "data" array or "series" array');
    }
}

export interface ArtifactValidation {
    errors: string[];
    warnings: string[];
}

const MERMAID_DIRECTIVES = [
    'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram-v2', 'stateDiagram',
    'erDiagram', 'journey', 'gantt', 'pie', 'mindmap', 'timeline', 'quadrantChart', 'gitGraph',
    'requirementDiagram', 'c4context', 'sankey-beta', 'xychart-beta', 'block-beta',
];

const countMatches = (text: string, re: RegExp): number => (text.match(re) || []).length;

/**
 * Static, dependency-free scan for the common ways a generated artifact is
 * broken — the mistakes models actually make: wrapping the source in a ```
 * fence, a wrong/absent mermaid directive, a truncated HTML document, an
 * unterminated `<script>`/`<style>`, or invalid chart JSON. It is NOT a full
 * browser/HTML-spec validator (that needs a headless browser we deliberately
 * don't ship); it's a fast lint that gives the agent actionable feedback so it
 * can fix the artifact with `edit_artifact` instead of shipping a broken one.
 */
export function validateArtifact(kind: ArtifactKind, content: string): ArtifactValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const text = content ?? '';
    const trimmed = text.trim();
    if (!trimmed) return { errors: ['content is empty'], warnings };

    // A leading ``` almost always means the model wrapped the whole artifact in
    // a markdown code fence — the backticks would render literally.
    if (kind !== 'markdown' && /^```/.test(trimmed)) {
        errors.push('content is wrapped in a ``` code fence — provide the raw source with no fences.');
    }

    switch (kind) {
        case 'chart':
            try { validateChartSpec(text); } catch (e) { errors.push((e as Error).message); }
            break;
        case 'mermaid': {
            const first = trimmed.split('\n')[0].trim().toLowerCase();
            if (!MERMAID_DIRECTIVES.some((d) => first === d || first.startsWith(`${d} `) || first.startsWith(`${d}\t`))) {
                errors.push(`first line "${trimmed.split('\n')[0].trim().slice(0, 40)}" is not a known mermaid diagram type (e.g. "flowchart TD", "sequenceDiagram", "gantt").`);
            }
            for (const [open, close, name] of [['[', ']', 'square bracket'], ['(', ')', 'parenthesis'], ['{', '}', 'brace']] as const) {
                const o = countMatches(text, new RegExp(`\\${open}`, 'g'));
                const c = countMatches(text, new RegExp(`\\${close}`, 'g'));
                if (o !== c) warnings.push(`unbalanced ${name}s (${o} "${open}" vs ${c} "${close}") — check the node syntax.`);
            }
            break;
        }
        case 'html': {
            const lower = text.toLowerCase();
            if (!lower.includes('<!doctype html') && !lower.includes('<html')) {
                warnings.push('no <!doctype html> / <html> — provide a complete standalone document.');
            }
            if (lower.includes('<html') && !lower.includes('</html>')) {
                errors.push('no closing </html> — the document looks truncated.');
            }
            for (const tag of ['script', 'style']) {
                const open = countMatches(lower, new RegExp(`<${tag}[\\s>]`, 'g'));
                const close = countMatches(lower, new RegExp(`</${tag}>`, 'g'));
                if (open !== close) errors.push(`<${tag}> is unbalanced (${open} open vs ${close} close) — an unterminated <${tag}> block breaks the page.`);
            }
            for (const tag of ['head', 'body']) {
                const open = countMatches(lower, new RegExp(`<${tag}[\\s>]`, 'g'));
                const close = countMatches(lower, new RegExp(`</${tag}>`, 'g'));
                if (open !== close) warnings.push(`<${tag}> opened ${open}× but closed ${close}× — check for an unclosed tag.`);
            }
            break;
        }
        case 'markdown':
            break; // markdown rarely has hard errors; the fence check above is enough.
    }
    return { errors, warnings };
}

/** One-line digest of a validation result for a tool message, or '' when clean. */
function validationNote(v: ArtifactValidation): string {
    const parts: string[] = [];
    if (v.errors.length) parts.push(`⚠ ${v.errors.length} error(s): ${v.errors.join('; ')}`);
    if (v.warnings.length) parts.push(`${v.warnings.length} warning(s): ${v.warnings.join('; ')}`);
    return parts.length ? `${parts.join(' · ')} — fix with edit_artifact.` : '';
}

/**
 * Constructor config for {@link ArtifactPlugin}. Pass a shared `sandbox` to
 * route artifact files through the same workspace as the rest of the agent;
 * otherwise a {@link LocalSandbox} rooted at `baseDir` is created.
 */
export interface ArtifactPluginConfig {
    baseDir?: string;
    sandbox?: Sandbox;
    /** Directory (sandbox-relative) artifacts are written to. Default `artifacts`. */
    dir?: string;
}

/**
 * Grants the agent the ability to produce **renderable artifacts** — full
 * websites (HTML), long-form documents (markdown), diagrams (mermaid) and data
 * visualisations (chart JSON) — that show in the canvas side-panel rather than
 * as plain text in the chat. Each artifact is also written to the sandbox so
 * the agent can re-read, edit, or run it like any other file.
 */
export default class ArtifactPlugin implements Plugin {
    name = 'ArtifactPlugin';
    private writer?: DataStreamWriter;
    private streamContext?: PluginStreamContext;
    private sandbox: Sandbox;
    private dir: string;
    private artifacts = new Map<string, ArtifactRecord>();
    private loaded = false;

    constructor(config: ArtifactPluginConfig = {}) {
        this.sandbox = config.sandbox ?? new LocalSandbox(config.baseDir ?? 'workspace');
        this.dir = config.dir ?? 'artifacts';
    }

    onStreamContextReady(context: PluginStreamContext) {
        this.streamContext = context;
        this.writer = context.writer.withDefaults({ plugin: this.name });
    }

    private artifactPath(id: string, kind: ArtifactKind): string {
        return path.posix.join(this.dir, `${id}.${EXT_BY_KIND[kind]}`);
    }

    private indexPath(): string {
        return path.posix.join(this.dir, '.artifacts.json');
    }

    /**
     * Repopulate the in-memory records from the on-disk index (once). Without
     * this, a session reload starts with an empty map and `recover()` would
     * reset every artifact to version 1 — so the NEXT edit emits a stale low
     * version the canvas (latest-version-wins) silently ignores, i.e. "editing
     * does nothing". The index keeps version/title/summary monotonic.
     */
    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return;
        this.loaded = true;
        try {
            const raw = await this.sandbox.readFile(this.indexPath());
            const records = JSON.parse(raw) as ArtifactRecord[];
            if (Array.isArray(records)) {
                for (const r of records) if (r?.id) this.artifacts.set(r.id, r);
            }
        } catch { /* no index yet (fresh dir or legacy artifacts) */ }
    }

    private async persistIndex(): Promise<void> {
        try {
            await this.sandbox.writeFile(this.indexPath(), JSON.stringify([...this.artifacts.values()], null, 2));
        } catch { /* best effort — the canvas content is authoritative */ }
    }

    /** Recover an artifact record when it isn't in memory: prefer the index, then
     *  fall back to a disk scan for legacy artifacts written before the index. */
    private async recover(id: string): Promise<ArtifactRecord | undefined> {
        await this.ensureLoaded();
        const known = this.artifacts.get(id);
        if (known) return known;
        for (const [ext, kind] of Object.entries(KIND_BY_EXT)) {
            const candidate = path.posix.join(this.dir, `${id}.${ext}`);
            if (await this.sandbox.exists(candidate)) {
                const record: ArtifactRecord = { id, title: id, kind, path: candidate, version: 1 };
                this.artifacts.set(id, record);
                return record;
            }
        }
        return undefined;
    }

    get tools(): Record<string, import("ai").Tool> {
        return {
            create_artifact: tool({
                description:
                    'Create a renderable artifact shown in the canvas side-panel: a website (html), ' +
                    'a document/book (markdown), a diagram (mermaid), or a data visualisation (chart). ' +
                    'Use this for substantial, self-contained content the user will view or reuse — ' +
                    'not for short answers, which belong in the chat. ' +
                    'This is the FULL-content tool: to fully REGENERATE an existing artifact in place, pass its `id` ' +
                    '(bumps the version). For a small change to an existing artifact, do NOT regenerate it here — use ' +
                    '`edit_artifact`, which only sends the diff.',
                inputSchema: z.object({
                    title: z.string().describe('Short human title, e.g. "Landing page" or "Q3 revenue chart".'),
                    kind: z
                        .enum(['html', 'markdown', 'mermaid', 'chart'])
                        .describe(
                            'html = full standalone HTML document (inline CSS/JS); ' +
                            'markdown = rich text/book; mermaid = diagram syntax; ' +
                            'chart = a JSON chart spec (see system prompt for schema).',
                        ),
                    content: z
                        .string()
                        .describe('The full source. For html, a complete <!doctype html> document.'),
                    summary: z.string().optional().describe('One-line description of the artifact.'),
                    id: z.string().optional().describe('Pass an existing artifact id to fully regenerate it in place (bumps the version). Omit to create a new artifact.'),
                }),
                execute: async ({ title, kind, content, summary, id: providedId }) => {
                    const operation = this.streamContext?.createOperation({
                        name: 'create-artifact',
                        toolName: 'create_artifact',
                        plugin: this.name,
                    });
                    // Scan before saving. A broken chart can't render at all, so
                    // it's a hard gate (as before); other kinds save + report so
                    // the agent can fix in place with edit_artifact.
                    const validation = validateArtifact(kind, content);
                    if (kind === 'chart' && validation.errors.length) throw new Error(validation.errors.join('; '));

                    // Regenerate-in-place when an existing id is supplied, else mint a new one.
                    const existing = providedId ? (this.artifacts.get(providedId) ?? await this.recover(providedId)) : undefined;
                    const id = providedId?.trim() || `${slugify(title)}-${Math.random().toString(36).slice(2, 6)}`;
                    const version = existing ? existing.version + 1 : 1;
                    const filePath = this.artifactPath(id, kind);
                    operation?.milestone(`${existing ? 'Regenerating' : 'Writing'} ${filePath}`, { phase: 'write' });
                    await this.sandbox.writeFile(filePath, content);

                    const record: ArtifactRecord = { id, title, kind, path: filePath, version, summary };
                    this.artifacts.set(id, record);
                    await this.persistIndex();

                    this.writer?.writeArtifact({
                        id,
                        title,
                        kind,
                        content,
                        version,
                        status: 'complete',
                        path: filePath,
                        summary,
                    });
                    const note = validationNote(validation);
                    const verb = existing ? 'Regenerated' : 'Created';
                    operation?.complete(note ? `${verb} “${title}” with issues` : `${verb} “${title}” (${kind})`, { phase: 'complete' });

                    return {
                        success: true,
                        id,
                        title,
                        kind,
                        version,
                        savedTo: filePath,
                        ...(validation.errors.length || validation.warnings.length ? { validation } : {}),
                        message: note
                            ? `Artifact "${title}" rendered, but the scan found problems. ${note}`
                            : `Artifact "${title}" is rendering in the canvas. For small changes use edit_artifact(id="${id}", old_string, new_string).`,
                    };
                },
            }),

            edit_artifact: tool({
                description:
                    'The DEFAULT, cheap way to revise an artifact: replace an exact substring in place — you send only ' +
                    'the diff, never the whole file. Use this for ANY small/targeted change (a tweak, a fix, a wording ' +
                    'change). Bumps the version and re-renders in the canvas. (Only reach for create_artifact with the ' +
                    'same id when you are genuinely regenerating the WHOLE thing.) You can also pass just title/summary ' +
                    'to rename without touching the content.',
                inputSchema: z.object({
                    id: z.string().describe('The artifact id (from create_artifact or list_artifacts).'),
                    old_string: z.string().optional().describe('Exact substring to replace, whitespace included. Must occur EXACTLY once unless replace_all is true. Omit only when just changing title/summary.'),
                    new_string: z.string().optional().describe('Replacement for old_string (use "" to delete it).'),
                    replace_all: z.boolean().optional().describe('Replace every occurrence instead of requiring a unique match.'),
                    title: z.string().optional().describe('Optional new title.'),
                    summary: z.string().optional().describe('Optional new one-line description.'),
                }),
                execute: async ({ id, old_string, new_string, replace_all, title, summary }) => {
                    const operation = this.streamContext?.createOperation({
                        name: 'edit-artifact',
                        toolName: 'edit_artifact',
                        plugin: this.name,
                    });
                    const existing = this.artifacts.get(id) ?? (await this.recover(id));
                    if (!existing) {
                        throw new Error(`No artifact with id "${id}". Use list_artifacts to see ids, or create_artifact to make a new one.`);
                    }

                    let next: string;
                    let replaced = 0;
                    if (old_string !== undefined) {
                        if (!old_string) throw new Error('old_string cannot be empty.');
                        if (new_string === undefined) throw new Error('new_string is required when old_string is given.');
                        if (old_string === new_string) throw new Error('old_string and new_string are identical — nothing to change.');
                        const current = await this.sandbox.readFile(existing.path);
                        const count = current.split(old_string).length - 1;
                        if (count === 0) {
                            throw new Error(`old_string not found in artifact "${id}". It must match the current content exactly (whitespace included) — read it first. For a complete regeneration, call create_artifact with this same id.`);
                        }
                        if (count > 1 && !replace_all) {
                            throw new Error(`old_string occurs ${count}× in artifact "${id}". To change ALL ${count}, pass replace_all:true. To change ONE, extend old_string with enough surrounding text to be unique. If the content is too repetitive to isolate (common in code/markup), don't keep retrying — regenerate the whole artifact with create_artifact(id="${id}", …).`);
                        }
                        // split/join is a LITERAL replace (no $-pattern interpretation) and
                        // handles both the unique (count === 1) and replace_all cases.
                        next = current.split(old_string).join(new_string);
                        replaced = replace_all ? count : 1;
                    } else {
                        // No old_string → title/summary-only rename; keep the content as-is.
                        if (title === undefined && summary === undefined) {
                            throw new Error('Nothing to change: pass old_string + new_string for a surgical edit, or a new title/summary to rename. For a full regeneration, use create_artifact with this id.');
                        }
                        next = await this.sandbox.readFile(existing.path);
                    }

                    const validation = validateArtifact(existing.kind, next);
                    if (existing.kind === 'chart' && validation.errors.length) {
                        throw new Error(`edit would break the chart: ${validation.errors.join('; ')}`);
                    }

                    const nextTitle = title ?? existing.title;
                    const nextSummary = summary ?? existing.summary;
                    const version = existing.version + 1;
                    operation?.milestone(`Editing ${existing.path}`, { phase: 'write' });
                    await this.sandbox.writeFile(existing.path, next);

                    const record: ArtifactRecord = { ...existing, title: nextTitle, version, summary: nextSummary };
                    this.artifacts.set(id, record);
                    await this.persistIndex();

                    this.writer?.writeArtifact({
                        id,
                        title: nextTitle,
                        kind: existing.kind,
                        content: next,
                        version,
                        status: 'complete',
                        path: existing.path,
                        summary: nextSummary,
                    });
                    const note = validationNote(validation);
                    operation?.complete(note ? `Edited “${nextTitle}” (v${version}) with issues` : `Edited “${nextTitle}” (v${version})`, { phase: 'complete' });

                    return {
                        success: true,
                        id,
                        title: nextTitle,
                        version,
                        savedTo: existing.path,
                        ...(replaced ? { replaced } : {}),
                        ...(validation.errors.length || validation.warnings.length ? { validation, message: note } : {}),
                    };
                },
            }),

            list_artifacts: tool({
                description: 'List the artifacts created in this session (id, title, kind, version).',
                inputSchema: z.object({}),
                execute: async () => {
                    await this.ensureLoaded();
                    const items = Array.from(this.artifacts.values()).map((a) => ({
                        id: a.id,
                        title: a.title,
                        kind: a.kind,
                        version: a.version,
                        path: a.path,
                    }));
                    this.writer?.writeStatus(`Listed ${items.length} artifact${items.length === 1 ? '' : 's'}`, undefined, undefined, {
                        transient: true,
                    });
                    return { count: items.length, artifacts: items };
                },
            }),
        };
    }

    modifySystemPrompt(prompt: string): string {
        return `${prompt}

## Canvas Artifacts
You can render rich, self-contained content in a canvas side-panel via \`create_artifact\` / \`edit_artifact\`. Reach for an artifact whenever the user wants something they'll *look at or reuse* — a webpage, a written document or book, a diagram, or a chart — instead of dumping it as chat text. Keep conversational replies in the chat; put the deliverable in an artifact.

Pick \`kind\`:
- \`html\` — a complete, standalone \`<!doctype html>\` document. Inline all CSS/JS (no external build step). This is the choice for "build me a website/landing page/app UI".
- \`markdown\` — long-form writing: docs, READMEs, books, reports. Use proper headings, lists, tables.
- \`mermaid\` — diagrams. Provide valid mermaid syntax (e.g. \`flowchart TD\`, \`sequenceDiagram\`, \`gantt\`, \`mindmap\`). Do NOT wrap it in markdown code fences.
- \`chart\` — data visualisation. \`content\` must be a JSON object:
  \`\`\`json
  {
    "type": "bar" | "line" | "area" | "pie",
    "title": "optional title",
    "xLabel": "optional", "yLabel": "optional",
    "data": [ { "label": "Jan", "value": 120 }, { "label": "Feb", "value": 98 } ]
  }
  \`\`\`
  For multiple lines/bars use \`"series": [ { "name": "2024", "color": "#e0a458", "points": [ {"label":"Jan","value":10} ] } ]\` instead of \`data\`.

Rules:
- After creating, mention it briefly in chat ("I've put the landing page in the canvas") — don't paste the full content back into the message.
- Revising an artifact — pick by the SIZE of the change, not by habit:
  - **Default to \`edit_artifact\`** (same \`id\`): a surgical \`old_string\`→\`new_string\` replace that sends ONLY the diff. \`old_string\` must match the current content EXACTLY (whitespace included) and be unique — include enough surrounding text to pin down the one spot you mean. Right for a tweak, a fix, a wording/colour change, adding a section. Make several small edits rather than one big rewrite.
  - **When a surgical edit isn't practical, regenerate** by calling \`create_artifact\` with the SAME \`id\`: when you're rewriting most of the file, OR when \`edit_artifact\` reports the \`old_string\` is ambiguous/not-found and the content is too repetitive to isolate a unique anchor. Do NOT retry \`edit_artifact\` more than once or twice on a match failure — switch to regenerating instead of looping.
- Every create/edit is auto-scanned for common breakage (stray \`\`\` fences, a wrong mermaid directive, a truncated/unbalanced HTML document, invalid chart JSON). If a tool result comes back with a \`validation\` block listing errors, FIX them with \`edit_artifact\` before telling the user it's done.
- Artifacts are saved under \`${this.dir}/\` in your workspace, so you can \`cat\`/edit them with bash too.`;
    }
}
