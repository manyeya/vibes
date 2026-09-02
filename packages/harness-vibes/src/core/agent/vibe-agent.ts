import * as path from 'path';
import { type LanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
    SkillsPlugin,
    PlanningPlugin,
    FilesystemPlugin,
    BashPlugin,
    RepoContextPlugin,
    SubAgentPlugin,
    SummarizationPlugin,
    ArtifactPlugin,
    ClarificationPlugin,
    GuardrailsPlugin,
    type Guardrail,
    WebSearchPlugin,
} from '../../plugins';
import MemoryPlugin from '../../plugins/memory';
import ModePlugin from '../../plugins/mode';
import {
    SubAgent,
    Plugin,
    ToolsRequiringApprovalConfig,
} from '../types';
import { VibesAgent, type VibesAgentConfig } from './agent';
import type { Sandbox } from '../sandbox';

/**
 * Configuration for initializing a VibeAgent instance.
 */
export interface VibeAgentConfig extends Partial<Omit<VibesAgentConfig, 'instructions'>> {
    /** Custom instructions to extend the base system prompt */
    systemPrompt?: string;
    /** Registry of sub-agents available for delegation */
    subAgents?: SubAgent[];
    /** If true, standard plugins (Tasks, Skills, Filesystem) will not be loaded */
    skipDefaultPlugins?: boolean;
    /** Optional shared state backend for state inheritance (used in sub-agents) */
    backend?: any;
    /** Unique session identifier for persistent SQLite storage */
    sessionId?: string;
    /** Path to the SQLite database file (default: workspace/vibes.db) */
    dbPath?: string;
    /**
     * Optional {@link Sandbox} backing the filesystem + shell plugins. When
     * omitted, those plugins fall back to a LocalSandbox rooted at
     * `workspaceDir`. Provide a sandbox to isolate or relocate execution
     * (e.g. a virtual or remote sandbox).
     */
    sandbox?: Sandbox;
    /**
     * Content guardrails (input/output validate-block-redact) added to the
     * GuardrailsPlugin. Secret-masking is on by default regardless; these are
     * extra caller-defined checks.
     */
    guardrails?: Guardrail[];
}

export interface DefaultPluginFactoryOptions {
    model: LanguageModel;
    workspaceDir: string;
    /**
     * Per-session plugin-state dir (plan/tasks/scratchpad/tracked_files).
     * Defaults to `workspaceDir`. For a workspace session this points at the
     * per-session `.vibes/sessions/{id}/` dir while the sandbox root stays the
     * SHARED project dir.
     */
    stateDir?: string;
    /**
     * Directory for cross-session shared state (memories.json).
     * Defaults to a value derived from `workspaceDir`.
     */
    sharedDir?: string;
    sessionId?: string;
    /** Sandbox shared by the filesystem + bash plugins for this agent. */
    sandbox?: Sandbox;
    /** Model context window (tokens) — drives token-based summarization. */
    contextWindow?: number;
    /** Fraction of the window at which summarization triggers (0–1). */
    compressionRatio?: number;
    /** Caller-defined content guardrails (secret-masking is on by default). */
    guardrails?: Guardrail[];
}

/**
 * Climb from a per-session directory to the cross-session shared root.
 * Handles both the legacy `workspace/sessions/{id}` layout and the workspace
 * `workspace/projects/{id}` layout, so memories stay global at
 * `workspace/` in both cases.
 */
function resolveSharedWorkspaceDir(workspaceDir: string): string {
    const normalized = path.normalize(workspaceDir);
    const parentDir = path.dirname(normalized);
    const parentName = path.basename(parentDir);

    if (parentName === 'sessions' || parentName === 'projects') {
        return path.dirname(parentDir);
    }

    return normalized;
}

export function createDefaultPlugins(config: DefaultPluginFactoryOptions): Plugin[] {
    const stateDir = config.stateDir ?? config.workspaceDir;
    const sharedWorkspaceDir = config.sharedDir ?? resolveSharedWorkspaceDir(config.workspaceDir);

    const plugins: Plugin[] = [
        new PlanningPlugin(config.model, {
            planPath: path.join(stateDir, 'plan.md'),
            tasksPath: path.join(stateDir, 'tasks.json'),
            maxRecitationTasks: 10,
        }),
        new SkillsPlugin({ workspaceDir: config.workspaceDir }),
        // Dedicated file tools — read / write / edit / list file content with
        // structured tools that stream diffs and file-op cards (read, write,
        // edit_file, list_files). File I/O runs in the (shared) project
        // sandbox; tracked_files bookkeeping is kept per-session in stateDir.
        new FilesystemPlugin({
            ...(config.sandbox ? { sandbox: config.sandbox } : { baseDir: config.workspaceDir }),
            trackedFilesPath: path.join(stateDir, 'tracked_files.json'),
        }),
        // Bash shell for running commands and exploring the workspace (search,
        // navigation, bulk transforms) — rooted at the same directory on disk.
        new BashPlugin(config.sandbox ? { sandbox: config.sandbox } : config.workspaceDir),
        // Auto-load human-authored repo guidance (CLAUDE.md / AGENTS.md) into the
        // system prompt — same workspace root as bash/filesystem.
        new RepoContextPlugin(config.sandbox ? { sandbox: config.sandbox } : config.workspaceDir),
        // Renderable artifacts (websites, docs, diagrams, charts) → canvas panel.
        // Rooted at the PER-SESSION stateDir, not the (possibly shared) project
        // sandbox — artifacts are conversation deliverables, so they belong to
        // the session like plan/tasks/scratchpad. This keeps sessions in one
        // project from pooling/colliding artifacts in a shared folder, and keeps
        // them out of an opened external repo. The canvas renders from the
        // inline `data-artifact` content (persisted per-session in ui_messages),
        // so the on-disk location is just a per-session backing copy.
        new ArtifactPlugin({ baseDir: stateDir }),
        // Ask the user structured clarifying questions (questionnaire above the composer).
        new ClarificationPlugin(),
        // Safety guardrails: secret-masking on input/output prose (on by default)
        // plus any caller-defined input/output content checks. Tool-output
        // secrets are masked separately at the tool-execute layer.
        new GuardrailsPlugin({ guardrails: config.guardrails }),
        // Rolling-summary plugin: keeps long conversations within token
        // budget by summarising the oldest excess messages once we exceed
        // 1.5x its threshold. Triggers before the agent's pruneMessages
        // fallback truncation.
        new SummarizationPlugin(config.model, {
            contextWindow: config.contextWindow,
            compressionRatio: config.compressionRatio,
        }),
    ];

    // Web search (Exa / Tavily / Brave) — only when a provider key is set, so
    // the agent isn't handed a tool that can only error.
    const webSearch = new WebSearchPlugin();
    if (webSearch.isEnabled) plugins.push(webSearch);

    // LAST on purpose: the scratchpad/notes index reloads from disk every turn,
    // so this volatile prompt section must trail the stable ones or every
    // scratchpad edit invalidates the KV cache for everything after it.
    plugins.push(new MemoryPlugin({
        scratchpadPath: path.join(stateDir, 'scratchpad.md'),
        notesPath: path.join(sharedWorkspaceDir, 'memories.json'),
    }));

    return plugins;
}

/**
 * Plugins for a **sub-agent** — a focused worker, not a second brain.
 *
 * Deliberately lean: filesystem, shell, skills, artifacts and planning only.
 * The heavy cognitive/orchestration plugins (Reasoning's auto tree-of-thoughts,
 * procedural memory, rolling summarization) are intentionally excluded — on a
 * delegated sub-task they bloat the system prompt and fire extra nested model
 * calls, which is exactly what made delegation slow and flaky. A sub-agent
 * should *do the task* with real tools and report back, not re-run the whole
 * planning stack.
 */
export function createSubAgentPlugins(config: DefaultPluginFactoryOptions): Plugin[] {
    const stateDir = config.stateDir ?? config.workspaceDir;

    const plugins: Plugin[] = [
        new PlanningPlugin(config.model, {
            planPath: path.join(stateDir, 'plan.md'),
            tasksPath: path.join(stateDir, 'tasks.json'),
            maxRecitationTasks: 10,
        }),
        new SkillsPlugin({ workspaceDir: config.workspaceDir }),
        // Dedicated file tools (read/write/edit_file/list_files) + bash for
        // commands and exploration, both rooted at the same workspace directory.
        new FilesystemPlugin({
            ...(config.sandbox ? { sandbox: config.sandbox } : { baseDir: config.workspaceDir }),
            trackedFilesPath: path.join(stateDir, 'tracked_files.json'),
        }),
        new BashPlugin(config.sandbox ? { sandbox: config.sandbox } : config.workspaceDir),
        // Per-session artifacts (see createDefaultPlugins) — a delegated worker's
        // deliverables belong to the same session, not the shared project dir.
        new ArtifactPlugin({ baseDir: stateDir }),
    ];

    // Research-capable workers get web search too, when configured.
    const webSearch = new WebSearchPlugin();
    if (webSearch.isEnabled) plugins.push(webSearch);

    return plugins;
}

/**
 * The stable base of the system prompt — the KV-cache prefix. Keep it short,
 * free of duplication with plugin sections (each plugin documents its own
 * tools), and free of anything volatile. Exported so tests can assert on it.
 */
export const VIBE_BASE_INSTRUCTIONS = `<identity>
You are VibeAgent, an autonomous software-engineering agent built on the Vibes framework. Your capabilities come from plugins; each documents its own tools in the sections that follow.
</identity>

<workflow>
1. Understand: explore the workspace first; always read a file before modifying it.
2. Plan: for multi-step work, create a real plan/task list (see the planning section); skip the ceremony for trivial asks.
3. Execute: one task at a time; prefer the dedicated file tools over shell edits.
4. Verify: re-read what you changed and confirm it does what you claim.
</workflow>

<conduct>
- Be concise and direct. No preamble, no restating the request, no closing summaries of what you just said.
- Batch independent tool calls in a single step instead of running them serially.
- Never claim work is done without verifying it. If something failed or was skipped, say so plainly — never paper over an error.
- Make the minimal change that does the job; match existing conventions; add code comments only where the code cannot speak for itself.
- If a tool fails twice with the same error, stop and rethink instead of retrying blindly.
- Security: assist with defensive or clearly authorized security work only; refuse to write malicious code regardless of framing.
</conduct>`;

/**
 * VibeAgent is a sophisticated AI agent framework built on Vercel AI SDK v6.
 * It supports multi-step reasoning, persistent state with task dependencies,
 * real filesystem access, modular skills, and sub-agent delegation.
 */
export class VibeAgent extends VibesAgent {
    private readonly vibeAgentConfig: VibeAgentConfig;
    private readonly parentCustomTools: Record<string, any>;
    private readonly parentApprovalConfig: ToolsRequiringApprovalConfig;

    /**
     * Initializes a new VibeAgent instance.
     * @param config Optional configuration to customize model, prompt, and plugins.
     */
    constructor(config: VibeAgentConfig = {}) {
        const normalizedConfig = { ...config };
        const baseInstructions = VIBE_BASE_INSTRUCTIONS;

        super({
            model: normalizedConfig.model || openai('gpt-4o'),
            instructions: baseInstructions,
            ...normalizedConfig,
        });

        this.vibeAgentConfig = normalizedConfig;
        this.parentCustomTools = { ...(normalizedConfig.tools ?? {}) };
        this.parentApprovalConfig = normalizedConfig.toolsRequiringApproval ?? [];

        // Initialize built-in plugins
        this.initializePlugins(normalizedConfig);
    }

    private initializePlugins(config: VibeAgentConfig): void {
        const skipDefaults = config.skipDefaultPlugins === true;
        const workspaceDir = config.workspaceDir || 'workspace';
        const stateDir = config.stateDir || workspaceDir;

        const defaults = skipDefaults ? [] : createDefaultPlugins({
            model: this.model,
            workspaceDir,
            stateDir,
            ...(config.sharedDir ? { sharedDir: config.sharedDir } : {}),
            sessionId: config.sessionId,
            sandbox: config.sandbox,
            contextWindow: this.contextWindow,
            compressionRatio: this.contextCompressionRatio,
            ...(config.guardrails ? { guardrails: config.guardrails } : {}),
        });
        // Registration order = system-prompt order. Volatile contributors (the
        // mutable sub-agent roster, then the disk-reloaded memory scratchpad)
        // go last so the stable prefix stays KV-cacheable.
        this.addPlugin(defaults.filter((p) => p.name !== 'MemoryPlugin'));

        // SubAgent plugin
        const subAgentMap = new Map<string, SubAgent>();

        if (config.subAgents) {
            config.subAgents.forEach(agent => {
                subAgentMap.set(agent.name, agent);
            });
        }

        // NOTE: sub-agents derive their own LocalSandbox from their per-agent
        // workspace dir for now. A shared virtual/remote sandbox would need to
        // be threaded here too — tracked as a follow-up for Phase 3.
        this.addPlugin(new SubAgentPlugin(
            subAgentMap,
            this.model,
            // Sub-agents run the LEAN plugin set, not the full default stack.
            ({ model, workspaceDir: subAgentWorkspaceDir }) => createSubAgentPlugins({
                model: model || this.model,
                workspaceDir: subAgentWorkspaceDir || workspaceDir,
                sessionId: this.vibeAgentConfig.sessionId,
            }),
            () => ({ ...this.parentCustomTools }),
            this.parentApprovalConfig,
            workspaceDir
        ))

        this.addPlugin(defaults.filter((p) => p.name === 'MemoryPlugin'));

        // The agent-facing half of modes: lets it switch its own mode (the user
        // switches through the UI/API). set_mode is read-classified, so it's
        // never gated — the agent can always change mode, even from plan.
        this.addPlugin(new ModePlugin({
            getMode: () => this.getMode(),
            // The agent only proposes; the user applies (setMode). This is why
            // the mode never changes out from under the user.
            suggestMode: (m, reason) => this.suggestMode(m, reason),
        }));

        // Custom plugins
        if (config.plugins) {
            this.addPlugin([...config.plugins]);
        }

        // Seed every window-aware plugin (summarization + sub-agents) with the
        // constructed context window now that they're all registered, so the
        // compression threshold and delegated sub-agents' gauges are framed
        // correctly even before the first per-request model override.
        this.setContextWindow(this.contextWindow, this.contextCompressionRatio);
    }
}

/**
 * Factory function to create a VibeAgent instance.
 * @param config Agent configuration object.
 */
export function createVibeAgent(config: VibeAgentConfig = {}): VibeAgent {
    return new VibeAgent(config);
}

