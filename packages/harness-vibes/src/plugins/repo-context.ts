import { type Plugin } from "../core/types";
import { type Sandbox } from "../core/sandbox";
import { LocalSandbox } from "../sandbox/local-sandbox";

/**
 * Constructor options for {@link RepoContextPlugin}. Mirrors
 * {@link BashPlugin}'s options so the plugin roots at the same workspace: pass
 * a `sandbox`, a `baseDir`, or a bare path string.
 */
export type RepoContextOptions = string | { sandbox?: Sandbox; baseDir?: string };

/** Guidance files, in read order. Both are concatenated when both exist. */
const GUIDANCE_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;

/**
 * Per-file cap (characters) on repo guidance pulled into the prompt. A trust
 * boundary: file length is untrusted, so a giant AGENTS.md can't eat the window.
 */
const MAX_CHARS = 12_000;

/**
 * Auto-loads the repo's human-authored agent guidance (`CLAUDE.md` / `AGENTS.md`
 * at the workspace root) into the system prompt — the "repo context injection"
 * that a coding agent otherwise has to rediscover every session.
 *
 * Read once and cached: {@link AgentHarness} runs the `modifySystemPrompt` chain
 * once per turn, so caching keeps the KV-cache prefix stable and avoids
 * re-reading disk each turn. Missing files are a silent no-op. Reads go through
 * the {@link Sandbox}, so they stay contained to the workspace root.
 */
export default class RepoContextPlugin implements Plugin {
    name = 'RepoContextPlugin';
    private sandbox: Sandbox;
    /** `undefined` = not loaded yet; a string (possibly empty) once loaded. */
    private cached?: string;

    constructor(options: RepoContextOptions = 'workspace') {
        if (typeof options === 'string') {
            this.sandbox = new LocalSandbox(options);
        } else if (options.sandbox) {
            this.sandbox = options.sandbox;
        } else {
            this.sandbox = new LocalSandbox(options.baseDir ?? 'workspace');
        }
    }

    /** Read + cap the guidance files. Best-effort: an unreadable file is skipped. */
    private async load(): Promise<string> {
        const parts: string[] = [];
        for (const file of GUIDANCE_FILES) {
            try {
                if (!(await this.sandbox.exists(file))) continue;
                let content = (await this.sandbox.readFile(file)).trim();
                if (!content) continue;
                if (content.length > MAX_CHARS) {
                    content = content.slice(0, MAX_CHARS) + '\n\n…[truncated]';
                }
                parts.push(`### ${file}\n\n${content}`);
            } catch {
                // A repo file we can't read shouldn't break prompt assembly.
            }
        }
        return parts.join('\n\n');
    }

    async modifySystemPrompt(prompt: string): Promise<string> {
        if (this.cached === undefined) this.cached = await this.load();
        if (!this.cached) return prompt;
        return `${prompt}

## Repository Context
Project guidance auto-loaded from the repository root. Treat it as authoritative for this codebase.

${this.cached}`;
    }
}
