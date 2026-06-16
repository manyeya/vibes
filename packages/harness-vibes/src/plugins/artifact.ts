import { tool, type UIMessageStreamWriter } from "ai";
import z from "zod";
import * as path from "path";
import {
    VibesUIMessage,
    Plugin,
    PluginStreamContext,
    createDataStreamWriter,
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

    constructor(config: ArtifactPluginConfig = {}) {
        this.sandbox = config.sandbox ?? new LocalSandbox(config.baseDir ?? 'workspace');
        this.dir = config.dir ?? 'artifacts';
    }

    onStreamContextReady(context: PluginStreamContext) {
        this.streamContext = context;
        this.writer = context.writer.withDefaults({ plugin: this.name });
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.streamContext = undefined;
        this.writer = createDataStreamWriter(writer).withDefaults({ plugin: this.name });
    }

    private artifactPath(id: string, kind: ArtifactKind): string {
        return path.posix.join(this.dir, `${id}.${EXT_BY_KIND[kind]}`);
    }

    /** Recover an artifact record from disk when it isn't in memory (e.g. after a reload). */
    private async recover(id: string): Promise<ArtifactRecord | undefined> {
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

    get tools() {
        return {
            create_artifact: tool({
                description:
                    'Create a renderable artifact shown in the canvas side-panel: a website (html), ' +
                    'a document/book (markdown), a diagram (mermaid), or a data visualisation (chart). ' +
                    'Use this for substantial, self-contained content the user will view or reuse — ' +
                    'not for short answers, which belong in the chat. The artifact is also saved to the ' +
                    'workspace so you can edit it later with update_artifact.',
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
                }),
                execute: async ({ title, kind, content, summary }) => {
                    const operation = this.streamContext?.createOperation({
                        name: 'create-artifact',
                        toolName: 'create_artifact',
                        plugin: this.name,
                        heartbeatEnabled: false,
                    });
                    if (kind === 'chart') validateChartSpec(content);

                    const id = `${slugify(title)}-${Math.random().toString(36).slice(2, 6)}`;
                    const filePath = this.artifactPath(id, kind);
                    operation?.milestone(`Writing ${filePath}`, { phase: 'write' });
                    await this.sandbox.writeFile(filePath, content);

                    const record: ArtifactRecord = { id, title, kind, path: filePath, version: 1, summary };
                    this.artifacts.set(id, record);

                    this.writer?.writeArtifact({
                        id,
                        title,
                        kind,
                        content,
                        version: 1,
                        status: 'complete',
                        path: filePath,
                        summary,
                    });
                    operation?.complete(`Created “${title}” (${kind})`, { phase: 'complete' });

                    return {
                        success: true,
                        id,
                        title,
                        kind,
                        version: 1,
                        savedTo: filePath,
                        message: `Artifact "${title}" is rendering in the canvas. Edit it with update_artifact(id="${id}").`,
                    };
                },
            }),

            update_artifact: tool({
                description:
                    'Replace the content (and optionally the title) of an existing artifact by id. ' +
                    'Bumps its version and re-renders it in place in the canvas.',
                inputSchema: z.object({
                    id: z.string().describe('The artifact id returned by create_artifact.'),
                    content: z.string().describe('The new full source (replaces the old content entirely).'),
                    title: z.string().optional().describe('Optional new title.'),
                    summary: z.string().optional().describe('Optional new one-line description.'),
                }),
                execute: async ({ id, content, title, summary }) => {
                    const operation = this.streamContext?.createOperation({
                        name: 'update-artifact',
                        toolName: 'update_artifact',
                        plugin: this.name,
                        heartbeatEnabled: false,
                    });
                    const existing = this.artifacts.get(id) ?? (await this.recover(id));
                    if (!existing) {
                        throw new Error(
                            `No artifact with id "${id}". Use list_artifacts to see ids, or create_artifact to make a new one.`,
                        );
                    }
                    if (existing.kind === 'chart') validateChartSpec(content);

                    const nextTitle = title ?? existing.title;
                    const nextSummary = summary ?? existing.summary;
                    const version = existing.version + 1;
                    operation?.milestone(`Rewriting ${existing.path}`, { phase: 'write' });
                    await this.sandbox.writeFile(existing.path, content);

                    const record: ArtifactRecord = {
                        ...existing,
                        title: nextTitle,
                        version,
                        summary: nextSummary,
                    };
                    this.artifacts.set(id, record);

                    this.writer?.writeArtifact({
                        id,
                        title: nextTitle,
                        kind: existing.kind,
                        content,
                        version,
                        status: 'complete',
                        path: existing.path,
                        summary: nextSummary,
                    });
                    operation?.complete(`Updated “${nextTitle}” (v${version})`, { phase: 'complete' });

                    return { success: true, id, title: nextTitle, version, savedTo: existing.path };
                },
            }),

            list_artifacts: tool({
                description: 'List the artifacts created in this session (id, title, kind, version).',
                inputSchema: z.object({}),
                execute: async () => {
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
You can render rich, self-contained content in a canvas side-panel via \`create_artifact\` / \`update_artifact\`. Reach for an artifact whenever the user wants something they'll *look at or reuse* — a webpage, a written document or book, a diagram, or a chart — instead of dumping it as chat text. Keep conversational replies in the chat; put the deliverable in an artifact.

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
- To revise, call \`update_artifact\` with the same \`id\` (it re-renders in place); don't create a near-duplicate.
- Artifacts are saved under \`${this.dir}/\` in your workspace, so you can \`cat\`/edit them with bash too.`;
    }
}
