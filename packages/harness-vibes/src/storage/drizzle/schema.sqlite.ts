import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * SQLite schema — the parallel of schema.pg.ts. Same column set, same
 * text-stored timestamps/JSON, so the backends share encode/decode logic.
 * Only the dialect-specific bits differ (autoincrement integer PK here vs
 * serial in Postgres).
 */

export const sessions = sqliteTable("sessions", {
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

export const messages = sqliteTable("messages", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id"),
    role: text("role"),
    content: text("content"),
    contentType: text("content_type"),
}, (t) => ({
    bySession: index("idx_messages_session_id").on(t.sessionId, t.id),
}));

export const workspaces = sqliteTable("workspaces", {
    id: text("id").primaryKey(),
    name: text("name"),
    rootDir: text("root_dir"),
    metadata: text("metadata"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
});

export const streams = sqliteTable("streams", {
    streamId: text("stream_id").primaryKey(),
    sessionId: text("session_id"),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    status: text("status"),
}, (t) => ({
    bySession: index("idx_streams_session_id").on(t.sessionId, t.startedAt),
    byEndedAt: index("idx_streams_ended_at").on(t.endedAt),
}));

export const streamLog = sqliteTable("stream_log", {
    streamId: text("stream_id").notNull(),
    chunkSeq: integer("chunk_seq").notNull(),
    payload: text("payload"),
    createdAt: text("created_at"),
}, (t) => ({
    pk: primaryKey({ columns: [t.streamId, t.chunkSeq] }),
    byCreatedAt: index("idx_stream_log_created_at").on(t.createdAt),
}));
