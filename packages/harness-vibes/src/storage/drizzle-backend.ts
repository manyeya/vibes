import { eq, and, or, asc, desc, gte, lt, isNull, isNotNull, count } from "drizzle-orm";
import type { AgentState } from "../core/types";
import StateBackend, {
    type SessionInfo,
    type StreamChunk,
    type StreamMeta,
    type LatestStream,
} from "./state-backend";
import type * as PgSchema from "./drizzle/schema.pg";

/**
 * The schema shape both dialects share. The Postgres schema is used as the
 * canonical type; the SQLite schema is structurally parallel (same table and
 * column names) and is passed in cast to this type.
 */
type StorageSchema = typeof PgSchema;

/**
 * `any` drizzle handle. ponytail: drizzle has no common database type across
 * dialects (postgres-js vs libsql), but both expose the same async query
 * builder + transaction API, so the query bodies below are written once and
 * run on either. The public `StateBackend` surface stays fully typed; only this
 * internal handle is loose. Upgrade path: a hand-written union interface if the
 * lost internal typing ever bites.
 */
type AnyDrizzle = any;


/**
 * One backend, every SQL dialect. Holds a **shared** connection owned by
 * `SessionStore` plus this view's `sessionId`; constructing one is cheap, so
 * the store can mint a per-call instance without touching the pool. Selected
 * by env in `connect.ts` (Postgres when `DATABASE_URL` is set, else SQLite).
 */
export default class DrizzleBackend extends StateBackend {
    constructor(
        private readonly db: AnyDrizzle,
        private readonly s: StorageSchema,
        private readonly sessionId: string,
    ) {
        super();
    }

    private now(): string {
        return new Date().toISOString();
    }

    /**
     * Decode stored content. Rows carry a `content_type`; legacy rows fall back
     * to a heuristic that tolerates user text starting with `[` or `{`.
     */
    private decodeContent(content: string, contentType: string | null | undefined): unknown {
        if (contentType === "json") {
            try { return JSON.parse(content); } catch { return content; }
        }
        if (contentType === "text") return content;
        if (content.startsWith("[") || content.startsWith("{")) {
            try { return JSON.parse(content); } catch { return content; }
        }
        return content;
    }

    /** Idempotently ensure this session's row exists before a write. */
    private async ensureSession(): Promise<void> {
        const now = this.now();
        await this.db
            .insert(this.s.sessions)
            .values({ id: this.sessionId, metadata: "{}", createdAt: now, updatedAt: now })
            .onConflictDoNothing();
    }

    // ---- active-session state ----

    async getState(): Promise<AgentState> {
        const s = this.s;
        const [session] = await this.db
            .select({ summary: s.sessions.summary, metadata: s.sessions.metadata })
            .from(s.sessions)
            .where(eq(s.sessions.id, this.sessionId))
            .limit(1);

        const rows: Array<{ role: string; content: string; contentType: string | null }> = await this.db
            .select({ role: s.messages.role, content: s.messages.content, contentType: s.messages.contentType })
            .from(s.messages)
            .where(eq(s.messages.sessionId, this.sessionId))
            .orderBy(asc(s.messages.id));

        return {
            messages: rows.map(m => ({
                role: m.role,
                content: this.decodeContent(m.content, m.contentType),
            })) as AgentState["messages"],
            metadata: JSON.parse(session?.metadata || "{}"),
            summary: session?.summary || undefined,
        };
    }

    async setState(state: Partial<AgentState>): Promise<void> {
        await this.ensureSession();
        const s = this.s;
        const now = this.now();
        await this.db.transaction(async (tx: AnyDrizzle) => {
            if (state.summary !== undefined) {
                await tx.update(s.sessions).set({ summary: state.summary, updatedAt: now }).where(eq(s.sessions.id, this.sessionId));
            }
            if (state.metadata !== undefined) {
                await tx.update(s.sessions).set({ metadata: JSON.stringify(state.metadata), updatedAt: now }).where(eq(s.sessions.id, this.sessionId));
            }
            if (state.summary === undefined && state.metadata === undefined) {
                await tx.update(s.sessions).set({ updatedAt: now }).where(eq(s.sessions.id, this.sessionId));
            }
            if (state.messages !== undefined) {
                await tx.delete(s.messages).where(eq(s.messages.sessionId, this.sessionId));
                const rows = state.messages.map(msg => {
                    const isString = typeof msg.content === "string";
                    return {
                        sessionId: this.sessionId,
                        role: msg.role,
                        content: isString ? (msg.content as string) : JSON.stringify(msg.content),
                        contentType: isString ? "text" : "json",
                    };
                });
                if (rows.length) await tx.insert(s.messages).values(rows);
            }
        });
    }

    async setUIMessages(messages: unknown[]): Promise<void> {
        await this.ensureSession();
        await this.db
            .update(this.s.sessions)
            .set({ uiMessages: JSON.stringify(messages), updatedAt: this.now() })
            .where(eq(this.s.sessions.id, this.sessionId));
    }

    async getUIMessages(): Promise<unknown[] | null> {
        const s = this.s;
        const [row] = await this.db
            .select({ uiMessages: s.sessions.uiMessages })
            .from(s.sessions)
            .where(eq(s.sessions.id, this.sessionId))
            .limit(1);
        if (!row?.uiMessages) return null;
        try {
            const parsed = JSON.parse(row.uiMessages);
            return Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    // ---- session management ----

    private toSessionInfo = (row: any): SessionInfo => ({
        id: row.id,
        summary: row.summary || undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        // A session's directory lives in its metadata; the legacy workspace_id
        // column is left in place (nullable) but no longer read or written.
        cwd: row.metadata ? JSON.parse(row.metadata)?.workspaceDir : undefined,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        messageCount: Number(row.messageCount ?? 0),
    });

    async listSessions(cwd?: string): Promise<SessionInfo[]> {
        const s = this.s;
        const rows = await this.db
            .select({
                id: s.sessions.id,
                summary: s.sessions.summary,
                metadata: s.sessions.metadata,
                createdAt: s.sessions.createdAt,
                updatedAt: s.sessions.updatedAt,
                messageCount: count(s.messages.id),
            })
            .from(s.sessions)
            .leftJoin(s.messages, eq(s.sessions.id, s.messages.sessionId))
            .groupBy(s.sessions.id)
            .orderBy(desc(s.sessions.updatedAt));
        const all = rows.map(this.toSessionInfo);
        // Filtered in JS: the directory lives inside the metadata JSON column,
        // and JSON predicates differ across sqlite/pg. Session counts are small.
        // ponytail: linear scan; push into SQL if this ever gets large.
        return cwd ? all.filter((row: SessionInfo) => row.cwd === cwd) : all;
    }

    async getSession(sessionId: string): Promise<SessionInfo | null> {
        const s = this.s;
        const [row] = await this.db
            .select({
                id: s.sessions.id,
                summary: s.sessions.summary,
                metadata: s.sessions.metadata,
                createdAt: s.sessions.createdAt,
                updatedAt: s.sessions.updatedAt,
                messageCount: count(s.messages.id),
            })
            .from(s.sessions)
            .leftJoin(s.messages, eq(s.sessions.id, s.messages.sessionId))
            .where(eq(s.sessions.id, sessionId))
            .groupBy(s.sessions.id);
        return row ? this.toSessionInfo(row) : null;
    }

    async createSession(title?: string, metadata: Record<string, any> = {}): Promise<string> {
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const now = this.now();
        const finalMetadata = title ? { ...metadata, title } : metadata;
        await this.db.insert(this.s.sessions).values({
            id: sessionId,
            summary: null,
            metadata: JSON.stringify(finalMetadata),
            createdAt: now,
            updatedAt: now,
        });
        return sessionId;
    }

    async deleteSession(sessionId: string): Promise<void> {
        const s = this.s;
        await this.db.transaction(async (tx: AnyDrizzle) => {
            await tx.delete(s.messages).where(eq(s.messages.sessionId, sessionId));
            await tx.delete(s.sessions).where(eq(s.sessions.id, sessionId));
        });
    }

    async updateSession(
        sessionId: string,
        updates: { title?: string; summary?: string; metadata?: Record<string, any> },
    ): Promise<void> {
        const now = this.now();
        // Upsert the row first so a freshly-created session can be titled — the
        // old SQLite backend relied on an eager insert in its constructor.
        await this.db
            .insert(this.s.sessions)
            .values({ id: sessionId, metadata: "{}", createdAt: now, updatedAt: now })
            .onConflictDoNothing();
        const current = await this.getSession(sessionId);
        if (!current) return;
        // MERGE over the DB's current metadata, never replace — the stream layer
        // writes token usage straight to this column, so a caller persisting an
        // older in-memory copy must not clobber it.
        const finalMetadata = { ...(current.metadata || {}), ...(updates.metadata || {}) };
        if (updates.title) finalMetadata.title = updates.title;
        await this.db
            .update(this.s.sessions)
            .set({
                summary: updates.summary !== undefined ? updates.summary : current.summary ?? null,
                metadata: JSON.stringify(finalMetadata),
                updatedAt: now,
            })
            .where(eq(this.s.sessions.id, sessionId));
    }

    // ---- workspace (project) management ----

    // ---- resumable stream persistence ----

    async beginStream(streamId: string, sessionId: string): Promise<void> {
        await this.db
            .insert(this.s.streams)
            .values({ streamId, sessionId, startedAt: this.now(), endedAt: null, status: "active" })
            .onConflictDoNothing();
    }

    async appendStreamChunk(streamId: string, chunkSeq: number, payload: unknown): Promise<void> {
        await this.db
            .insert(this.s.streamLog)
            .values({ streamId, chunkSeq, payload: JSON.stringify(payload), createdAt: this.now() })
            .onConflictDoNothing();
    }

    async endStream(streamId: string, status: "completed" | "failed"): Promise<void> {
        await this.db
            .update(this.s.streams)
            .set({ endedAt: this.now(), status })
            .where(eq(this.s.streams.streamId, streamId));
    }

    async readStreamChunks(streamId: string, fromSeq: number = 0): Promise<StreamChunk[]> {
        const s = this.s;
        const rows: Array<{ chunkSeq: number; payload: string; createdAt: string }> = await this.db
            .select({ chunkSeq: s.streamLog.chunkSeq, payload: s.streamLog.payload, createdAt: s.streamLog.createdAt })
            .from(s.streamLog)
            .where(and(eq(s.streamLog.streamId, streamId), gte(s.streamLog.chunkSeq, fromSeq)))
            .orderBy(asc(s.streamLog.chunkSeq));
        return rows.map(r => ({
            chunkSeq: r.chunkSeq,
            payload: (() => { try { return JSON.parse(r.payload); } catch { return r.payload; } })(),
            createdAt: r.createdAt,
        }));
    }

    async getStreamMeta(streamId: string): Promise<StreamMeta | null> {
        const s = this.s;
        const [row] = await this.db
            .select({ sessionId: s.streams.sessionId, startedAt: s.streams.startedAt, endedAt: s.streams.endedAt, status: s.streams.status })
            .from(s.streams)
            .where(eq(s.streams.streamId, streamId))
            .limit(1);
        if (!row) return null;
        return { sessionId: row.sessionId, startedAt: row.startedAt, endedAt: row.endedAt, status: row.status };
    }

    async getLatestStream(sessionId: string): Promise<LatestStream | null> {
        const s = this.s;
        const [row] = await this.db
            .select({ streamId: s.streams.streamId, startedAt: s.streams.startedAt, endedAt: s.streams.endedAt, status: s.streams.status })
            .from(s.streams)
            .where(eq(s.streams.sessionId, sessionId))
            .orderBy(desc(s.streams.startedAt))
            .limit(1);
        if (!row) return null;
        return { streamId: row.streamId, startedAt: row.startedAt, endedAt: row.endedAt, status: row.status };
    }

    async cleanupStreams(olderThanIso: string): Promise<number> {
        const s = this.s;
        let total = 0;
        await this.db.transaction(async (tx: AnyDrizzle) => {
            // ISO-8601 strings sort chronologically, so a lexical `<` is a time
            // comparison. Count first (portable across dialects), then delete.
            const [c] = await tx.select({ n: count() }).from(s.streamLog).where(lt(s.streamLog.createdAt, olderThanIso));
            total = Number(c?.n ?? 0);
            await tx.delete(s.streamLog).where(lt(s.streamLog.createdAt, olderThanIso));
            await tx.delete(s.streams).where(
                or(
                    and(isNotNull(s.streams.endedAt), lt(s.streams.endedAt, olderThanIso)),
                    and(isNull(s.streams.endedAt), lt(s.streams.startedAt, olderThanIso)),
                ),
            );
        });
        return total;
    }
}
