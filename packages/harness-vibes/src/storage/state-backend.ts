import { AgentState } from "../core/types";

/**
 * Session metadata for listing sessions.
 */
export interface SessionInfo {
    id: string;
    summary?: string;
    metadata?: Record<string, any>;
    createdAt?: string;
    updatedAt?: string;
    messageCount?: number;
    /** The workspace (project) this session belongs to, if any. */
    workspaceId?: string;
}

/**
 * Workspace (project) metadata. A workspace groups multiple sessions that
 * share one project directory (`rootDir`). See the session manager for how
 * the shared sandbox + per-session `.vibes/sessions/{id}/` state dirs hang
 * off `rootDir`.
 */
export interface WorkspaceInfo {
    id: string;
    name: string;
    /** Absolute or workspace-relative project directory shared by the sessions. */
    rootDir: string;
    metadata?: Record<string, any>;
    createdAt?: string;
    updatedAt?: string;
    /** Number of sessions in this workspace (populated by listWorkspaces). */
    sessionCount?: number;
}

/** A single persisted resumable-stream chunk. */
export interface StreamChunk {
    chunkSeq: number;
    payload: unknown;
    createdAt: string;
}

/** Stream bookkeeping row. */
export interface StreamMeta {
    sessionId: string;
    startedAt: string;
    endedAt: string | null;
    status: string;
}

/** Latest stream pointer for a session (for session-keyed reconnect). */
export interface LatestStream {
    streamId: string;
    startedAt: string;
    endedAt: string | null;
    status: string;
}

/**
 * Abstract persistence backend for the agent.
 *
 * This is the multi-database seam: one interface, N concrete dialects
 * (Postgres and SQLite ship today; MySQL/etc. are a later schema + backend
 * class). `SessionStore` and the streaming layer depend on this type, never
 * a concrete backend, so swapping dialects is a connection-string change.
 *
 * All methods are async — `postgres-js` has no sync API, so async is the
 * lowest common denominator across dialects. The SQLite backend wraps its
 * synchronous `better-sqlite3` calls to satisfy the same contract.
 */
export default abstract class StateBackend {
    // ---- active-session state ----
    abstract getState(): Promise<AgentState>;
    abstract setState(state: Partial<AgentState>): Promise<void>;
    abstract setUIMessages(messages: unknown[]): Promise<void>;
    abstract getUIMessages(): Promise<unknown[] | null>;

    // ---- session management ----
    abstract listSessions(workspaceId?: string): Promise<SessionInfo[]>;
    abstract getSession(sessionId: string): Promise<SessionInfo | null>;
    abstract createSession(title?: string, metadata?: Record<string, any>, workspaceId?: string): Promise<string>;
    abstract deleteSession(sessionId: string): Promise<void>;
    abstract updateSession(
        sessionId: string,
        updates: { title?: string; summary?: string; metadata?: Record<string, any>; workspaceId?: string },
    ): Promise<void>;

    // ---- workspace (project) management ----
    abstract listWorkspaces(): Promise<WorkspaceInfo[]>;
    abstract getWorkspace(workspaceId: string): Promise<WorkspaceInfo | null>;
    abstract createWorkspace(workspace: { id: string; name: string; rootDir: string; metadata?: Record<string, any> }): Promise<WorkspaceInfo>;
    abstract setWorkspaceRootDir(workspaceId: string, rootDir: string): Promise<void>;
    abstract updateWorkspace(workspaceId: string, updates: { name?: string; metadata?: Record<string, any> }): Promise<void>;
    abstract deleteWorkspace(workspaceId: string): Promise<void>;

    // ---- resumable stream persistence ----
    abstract beginStream(streamId: string, sessionId: string): Promise<void>;
    abstract appendStreamChunk(streamId: string, chunkSeq: number, payload: unknown): Promise<void>;
    abstract endStream(streamId: string, status: 'completed' | 'failed'): Promise<void>;
    abstract readStreamChunks(streamId: string, fromSeq?: number): Promise<StreamChunk[]>;
    abstract getStreamMeta(streamId: string): Promise<StreamMeta | null>;
    abstract getLatestStream(sessionId: string): Promise<LatestStream | null>;
    abstract cleanupStreams(olderThanIso: string): Promise<number>;

    /**
     * Per-session backends share one connection owned by `SessionStore`, so
     * this is a no-op by default — closing the shared pool is the store's job.
     * Override only if a backend genuinely owns a per-instance handle.
     */
    async close(): Promise<void> {
        /* shared connection: owned by SessionStore */
    }
}
