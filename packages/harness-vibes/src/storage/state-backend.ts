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
    /** Directory this session works in (mirrors metadata.workspaceDir). */
    cwd?: string;
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
    /** Sessions rooted at `cwd` (all sessions when omitted). */
    abstract listSessions(cwd?: string): Promise<SessionInfo[]>;
    abstract getSession(sessionId: string): Promise<SessionInfo | null>;
    abstract createSession(title?: string, metadata?: Record<string, any>): Promise<string>;
    abstract deleteSession(sessionId: string): Promise<void>;
    abstract updateSession(
        sessionId: string,
        updates: { title?: string; summary?: string; metadata?: Record<string, any> },
    ): Promise<void>;


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
