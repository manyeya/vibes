import { pgTable, text, integer, serial, index, primaryKey } from "drizzle-orm/pg-core";

/**
 * Postgres schema. Timestamps are ISO strings in `text` columns and JSON is
 * stored as serialized `text` (not jsonb) so the backend's manual
 * JSON.stringify/parse + content_type decode is shared verbatim with the
 * SQLite schema — the two dialects stay parallel.
 */

export const sessions = pgTable("sessions", {
    id: text("id").primaryKey(),
    summary: text("summary"),
    metadata: text("metadata"),
    workspaceId: text("workspace_id"),
    uiMessages: text("ui_messages"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
}, (t) => ({
    byWorkspace: index("idx_sessions_workspace_id").on(t.workspaceId, t.updatedAt),
}));

export const messages = pgTable("messages", {
    id: serial("id").primaryKey(),
    sessionId: text("session_id"),
    role: text("role"),
    content: text("content"),
    contentType: text("content_type"),
}, (t) => ({
    bySession: index("idx_messages_session_id").on(t.sessionId, t.id),
}));

export const workspaces = pgTable("workspaces", {
    id: text("id").primaryKey(),
    name: text("name"),
    rootDir: text("root_dir"),
    metadata: text("metadata"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
});

export const streams = pgTable("streams", {
    streamId: text("stream_id").primaryKey(),
    sessionId: text("session_id"),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    status: text("status"),
}, (t) => ({
    bySession: index("idx_streams_session_id").on(t.sessionId, t.startedAt),
    byEndedAt: index("idx_streams_ended_at").on(t.endedAt),
}));

export const streamLog = pgTable("stream_log", {
    streamId: text("stream_id").notNull(),
    chunkSeq: integer("chunk_seq").notNull(),
    payload: text("payload"),
    createdAt: text("created_at"),
}, (t) => ({
    pk: primaryKey({ columns: [t.streamId, t.chunkSeq] }),
    byCreatedAt: index("idx_stream_log_created_at").on(t.createdAt),
}));
