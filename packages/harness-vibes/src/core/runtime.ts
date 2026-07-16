import { generateText, Output, type LanguageModel, type ModelMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { ZodType } from 'zod';
import { VibeAgent, type VibeAgentConfig } from './agent/vibe-agent';
import { VibesAgent } from './agent';
import type { AgentState } from './types';
import type { Sandbox } from './sandbox';
import { SessionStore } from './session/session-manager';
import type StateBackend from '../storage/state-backend';
import type { SessionInfo, WorkspaceInfo } from '../storage/state-backend';

/**
 * Public agent definition (Phase 2).
 *
 * This is the small, Flue-like front door to the harness: describe an
 * agent declaratively, hand it to {@link createRuntime}, open a
 * {@link Session}, and call {@link Session.prompt}. Everything underneath
 * (plugins, sandbox, memory, reasoning) is the flagship VibeAgent engine.
 */
export interface AgentDefinition extends VibeAgentConfig { }

/**
 * An agent definition, or a thunk returning one. The lazy form mirrors
 * Flue's `defineAgent(() => ({ ... }))` and is handy when the model or
 * sandbox must be resolved at harness-creation time.
 */
export type AgentFactory = AgentDefinition | (() => AgentDefinition);

export interface RuntimeOptions {
    /** Sandbox to back the agent's filesystem + shell. Overrides the definition's sandbox. */
    sandbox?: Sandbox;
    /** Workspace directory. Overrides the definition's workspaceDir. */
    workspaceDir?: string;
    /**
     * Postgres connection string. When set, sessions persist to Postgres;
     * otherwise they fall back to a local SQLite file at {@link dbPath}.
     */
    databaseUrl?: string;
    /** SQLite file path for persisted sessions when no `databaseUrl` is set (default: workspace/vibes.db). */
    dbPath?: string;
    /** Root directory for legacy per-session workspaces (default: workspace/sessions). */
    sessionsDir?: string;
    /** Root directory for workspace (project) dirs (default: workspace/projects). */
    projectsDir?: string;
}

export interface SessionOptions {
    /** Stable session id. Reusing it continues a persisted session. */
    id?: string;
    /**
     * Persist + cache this session (workspace dir + SQLite + reused agent).
     * Defaults to true. Set false for a throwaway, in-memory one-shot.
     */
    persist?: boolean;
    /** Per-session sandbox override (ephemeral sessions only). */
    sandbox?: Sandbox;
    /** Per-session workspace override (ephemeral sessions only). */
    workspaceDir?: string;
    /** Session title (persisted sessions). */
    title?: string;
    /** Session metadata (persisted sessions). */
    metadata?: Record<string, unknown>;
    /** Workspace (project) this session belongs to. Sessions in a workspace
     *  share the workspace's project dir as their sandbox root. */
    workspaceId?: string;
}

export interface PromptOptions<T> {
    /**
     * Optional schema for a typed, validated result. When provided, the
     * agent's final answer is coerced into an object matching the schema
     * and returned on {@link PromptResult.data}.
     */
    result?: ZodType<T>;
    /** Abort signal for the run. */
    abortSignal?: AbortSignal;
}

export interface PromptResult<T> {
    /** The agent's final text answer. */
    text: string;
    /** The structured result, present only when {@link PromptOptions.result} was supplied. */
    data?: T;
    /** Number of model steps the tool loop took. */
    steps: number;
    /** Token usage for the run. */
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
    /** The full agent state after the run (messages, metadata, summary). */
    state: AgentState;
}

type GenerateOptions = Parameters<VibesAgent['generate']>[0];

/**
 * A conversation scope bound to a single agent instance. The single owner
 * of a session's live state: its agent, workspace, and (for persisted
 * sessions) its SQLite backend.
 */
export class Session {
    /** Stable session id. */
    readonly id: string;
    /** Absolute workspace directory for this session. */
    readonly workspaceDir: string;
    /** Persistent backend, present for persisted (non-ephemeral) sessions. */
    readonly backend?: StateBackend;
    private readonly agent: VibesAgent;
    private readonly model: LanguageModel;

    constructor(init: {
        id: string;
        agent: VibesAgent;
        model: LanguageModel;
        workspaceDir: string;
        backend?: StateBackend;
    }) {
        this.id = init.id;
        this.agent = init.agent;
        this.model = init.model;
        this.workspaceDir = init.workspaceDir;
        this.backend = init.backend;
    }

    /** The underlying agent, for advanced/streaming use. */
    get raw(): VibesAgent {
        return this.agent;
    }

    /**
     * Run the agent to a final answer.
     *
     * With `options.result`, a second, tool-free pass coerces the answer
     * into a typed object validated against the schema. This keeps the
     * full multi-step tool loop intact (the agent reasons freely) while
     * still returning structured data — the AI SDK's per-call API does not
     * accept `experimental_output`, so a focused extraction pass is the
     * robust, provider-agnostic way to get both.
     */
    async prompt<T = never>(
        input: string | ModelMessage[],
        options: PromptOptions<T> = {},
    ): Promise<PromptResult<T>> {
        const messages: ModelMessage[] = typeof input === 'string'
            ? [{ role: 'user', content: input }]
            : input;

        const result = await this.agent.generate({
            messages,
            ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
        } as GenerateOptions);

        const text = result.text ?? '';

        let data: T | undefined;
        if (options.result) {
            const structured = await generateText({
                model: this.model,
                output: Output.object({ schema: options.result }),
                prompt: `Convert the assistant's final answer below into a structured object that matches the required schema. Use only information present in the answer.\n\n<answer>\n${text}\n</answer>`,
                ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
            });
            data = structured.output as T;
        }

        // Report usage summed across EVERY step (`totalUsage`), not just the
        // last step (`usage`) — a multi-step tool loop would otherwise badly
        // undercount. Matches what the streaming path persists.
        const u = (result.totalUsage ?? result.usage) as
            | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
            | undefined;
        return {
            text,
            data,
            steps: result.steps?.length ?? 0,
            usage: {
                inputTokens: u?.inputTokens ?? 0,
                outputTokens: u?.outputTokens ?? 0,
                totalTokens: u?.totalTokens ?? (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0),
            },
            state: result.state,
        };
    }

    /**
     * Stream a response. Thin passthrough to the agent's streaming API;
     * pass a `writer` to receive real-time plugin/tool data parts.
     */
    async stream(input: string | ModelMessage[], options: { writer?: unknown; abortSignal?: AbortSignal } = {}) {
        const messages: ModelMessage[] = typeof input === 'string'
            ? [{ role: 'user', content: input }]
            : input;
        return this.agent.stream({ messages, ...options } as Parameters<VibesAgent['stream']>[0]);
    }
}

/**
 * A configured handle over an agent definition AND the single owner of
 * session lifecycle: identity, workspace, persisted state, and the agent
 * instance. The HTTP layer (or any other caller) goes through here rather
 * than caching agents or opening backends itself.
 */
export class AgentRuntime {
    private readonly definition: AgentDefinition;
    private readonly model: LanguageModel;
    private readonly store: SessionStore;
    private readonly cache = new Map<string, Session>();

    constructor(definition: AgentDefinition, options: RuntimeOptions = {}) {
        this.definition = definition;
        this.model = definition.model ?? openai('gpt-4o');
        this.store = new SessionStore({
            databaseUrl: options.databaseUrl,
            dbPath: options.dbPath,
            sessionsDir: options.sessionsDir,
            projectsDir: options.projectsDir,
            // Build the flagship agent for each session, rooted at a sandbox
            // for that session's workspace. A definition-level sandbox (or a
            // harness-level override) wins over the per-session local one.
            // `stateDir` keeps per-session plugin state isolated even when the
            // sandbox root is a workspace's shared project dir.
            agentFactory: (ctx) => new VibeAgent({
                ...this.definition,
                model: this.model,
                sessionId: ctx.sessionId,
                workspaceDir: ctx.workspaceDir,
                stateDir: ctx.stateDir,
                sharedDir: ctx.sharedDir,
                sandbox: this.definition.sandbox ?? options.sandbox ?? ctx.sandbox,
            }),
        });
    }

    /**
     * Open a session. Persisted + cached by default (one agent instance per
     * id); pass `{ persist: false }` for a throwaway one-shot.
     */
    async session(idOrOptions?: string | SessionOptions): Promise<Session> {
        const opts: SessionOptions = typeof idOrOptions === 'string'
            ? { id: idOrOptions }
            : (idOrOptions ?? {});

        if (opts.persist === false) {
            return this.ephemeralSession(opts);
        }

        const stored = await this.store.getOrCreateSession({
            id: opts.id,
            title: opts.title,
            metadata: opts.metadata as Record<string, any> | undefined,
            workspaceId: opts.workspaceId,
        });

        let session = this.cache.get(stored.id);
        if (!session) {
            session = new Session({
                id: stored.id,
                agent: stored.agent,
                model: this.model,
                workspaceDir: stored.workspaceDir,
                backend: stored.backend,
            });
            this.cache.set(stored.id, session);
        }
        return session;
    }

    private ephemeralSession(opts: SessionOptions): Session {
        const sandbox = opts.sandbox ?? this.definition.sandbox;
        const workspaceDir =
            opts.workspaceDir ?? this.definition.workspaceDir ?? sandbox?.root ?? 'workspace';
        const agent = new VibeAgent({
            ...this.definition,
            model: this.model,
            workspaceDir,
            ...(sandbox ? { sandbox } : {}),
        });
        return new Session({ id: opts.id ?? 'ephemeral', agent, model: this.model, workspaceDir });
    }

    // ── Session catalog (single source of truth) ─────────────────────────

    /** Create (or return) a persisted session record and return its id. */
    async createSession(opts: { id?: string; title?: string; metadata?: Record<string, any>; workspaceId?: string } = {}): Promise<string> {
        const stored = await this.store.getOrCreateSession(opts);
        return stored.id;
    }

    /** List all known sessions, optionally scoped to one workspace. */
    listSessions(workspaceId?: string): Promise<SessionInfo[]> {
        return this.store.listSessions(workspaceId);
    }

    // ── Workspace (project) catalog ──────────────────────────────────────

    /** List all workspaces (with session counts). */
    listWorkspaces(): Promise<WorkspaceInfo[]> {
        return this.store.listWorkspaces();
    }

    /** Read one workspace, or null. */
    getWorkspace(id: string): Promise<WorkspaceInfo | null> {
        return this.store.getWorkspace(id);
    }

    /**
     * Create a workspace. Omit `rootDir` for a fresh app-managed project dir,
     * or pass `rootDir` to open an EXISTING folder on disk (Codex / Claude-
     * cowork style).
     */
    createWorkspace(opts: { id?: string; name?: string; rootDir?: string; metadata?: Record<string, any> }): Promise<WorkspaceInfo> {
        return this.store.createWorkspace(opts);
    }

    /** Rename / update a workspace's metadata. */
    updateWorkspace(id: string, updates: { name?: string; metadata?: Record<string, any> }): Promise<void> {
        return this.store.updateWorkspace(id, updates);
    }

    /** Delete a workspace, its sessions, and its on-disk project dir. */
    async deleteWorkspace(id: string): Promise<void> {
        // Drop cached Session handles for this workspace's sessions first.
        const sessions = await this.store.listSessions(id);
        for (const s of sessions) this.cache.delete(s.id);
        await this.store.deleteWorkspace(id);
    }

    /** Read session metadata without loading the agent. */
    getSessionInfo(id: string): Promise<SessionInfo | null> {
        return this.store.getSessionInfo(id);
    }

    /** Update session title/summary/metadata. */
    updateSession(id: string, updates: { title?: string; summary?: string; metadata?: Record<string, any> }): Promise<void> {
        return this.store.updateSession(id, updates);
    }

    /** Delete a session (cache + workspace + metadata). */
    async deleteSession(id: string): Promise<void> {
        this.cache.delete(id);
        await this.store.deleteSession(id);
    }

    /** Read persisted state (messages/summary/metadata) cheaply, no agent build. */
    readState(id: string): Promise<AgentState> {
        return this.store.readState(id);
    }

    /** Read persisted UI messages (full parts incl. data-* activity), or null. */
    readUIMessages(id: string): Promise<unknown[] | null> {
        return this.store.readUIMessages(id);
    }

    /** Absolute workspace directory for a session id. */
    getSessionWorkspace(id: string): Promise<string> {
        return this.store.getSessionWorkspace(id);
    }

    /**
     * A persistence backend bound to a session id, over the store's shared
     * connection. For callers that only know a session id (e.g. reconnect /
     * cleanup endpoints) and don't want to load the agent.
     */
    backend(id: string): Promise<StateBackend> {
        return this.store.openBackend(id);
    }

    /** Escape hatch: the underlying store, for advanced lifecycle control. */
    get sessions(): SessionStore {
        return this.store;
    }
}

/**
 * Declare an agent. Returns the definition (or thunk) unchanged so it can
 * be exported from a module and consumed by {@link createRuntime}.
 */
export function defineAgent(definition: AgentFactory): AgentFactory {
    return definition;
}

/**
 * Build a {@link AgentRuntime} from an agent definition. Equivalent to Flue's
 * `init(agent)`.
 */
export function createRuntime(factory: AgentFactory, options: RuntimeOptions = {}): AgentRuntime {
    const def = typeof factory === 'function' ? factory() : factory;
    const merged: AgentDefinition = {
        ...def,
        ...(options.sandbox ? { sandbox: options.sandbox } : {}),
        ...(options.workspaceDir ? { workspaceDir: options.workspaceDir } : {}),
    };
    return new AgentRuntime(merged, options);
}
