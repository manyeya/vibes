import * as path from "path";
import * as fs from "fs";
import StateBackend from "./state-backend";
import DrizzleBackend from "./drizzle-backend";
// Schema modules are driver-free (just table definitions), so static imports
// are cheap — only the heavy DB drivers below are lazy-imported.
import * as pgSchema from "./drizzle/schema.pg";
import * as sqliteSchema from "./drizzle/schema.sqlite";

/**
 * A live storage connection. Owns the single shared DB handle (pool) for a
 * process; `makeBackend` mints cheap per-session views over it.
 */
export interface StoreConnection {
    /** A per-session backend view over the shared connection. Cheap to create. */
    makeBackend(sessionId: string): StateBackend;
    /** Close the shared connection/pool. Owned here, not by per-session backends. */
    close(): Promise<void>;
}

export interface ConnectOptions {
    /** Postgres connection string. When set, Postgres is used. */
    databaseUrl?: string;
    /** SQLite file path (used when `databaseUrl` is unset). Default workspace/vibes.db. */
    dbPath?: string;
}

/**
 * Idempotent DDL. ponytail: a hand-written `CREATE TABLE IF NOT EXISTS` set
 * (mirrors the old init()) instead of drizzle-kit generated migrations — no SQL
 * files to bundle into the published package, runs on every boot for free.
 * Upgrade path: switch to `drizzle-kit generate` + `migrate()` once the schema
 * evolves enough to need ordered, tracked migrations.
 */
function ddl(messagesId: string): string[] {
    return [
        `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, summary TEXT, metadata TEXT, workspace_id TEXT, ui_messages TEXT, created_at TEXT, updated_at TEXT)`,
        `CREATE TABLE IF NOT EXISTS messages (id ${messagesId}, session_id TEXT, role TEXT, content TEXT, content_type TEXT)`,
        `CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id, id)`,
        `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT, root_dir TEXT, metadata TEXT, created_at TEXT, updated_at TEXT)`,
        `CREATE INDEX IF NOT EXISTS idx_sessions_workspace_id ON sessions(workspace_id, updated_at)`,
        `CREATE TABLE IF NOT EXISTS streams (stream_id TEXT PRIMARY KEY, session_id TEXT, started_at TEXT, ended_at TEXT, status TEXT)`,
        `CREATE INDEX IF NOT EXISTS idx_streams_session_id ON streams(session_id, started_at)`,
        `CREATE INDEX IF NOT EXISTS idx_streams_ended_at ON streams(ended_at)`,
        `CREATE TABLE IF NOT EXISTS stream_log (stream_id TEXT NOT NULL, chunk_seq INTEGER NOT NULL, payload TEXT, created_at TEXT, PRIMARY KEY (stream_id, chunk_seq))`,
        `CREATE INDEX IF NOT EXISTS idx_stream_log_created_at ON stream_log(created_at)`,
    ];
}

/**
 * Build the shared connection for the configured dialect, ensure the schema
 * exists, and return a factory for per-session backends.
 *
 * Drivers are lazy-imported so an install only pays for the one it uses
 * (both are optionalDependencies).
 */
export async function connectStore(opts: ConnectOptions): Promise<StoreConnection> {
    if (opts.databaseUrl) {
        const postgres = (await import("postgres")).default;
        const { drizzle } = await import("drizzle-orm/postgres-js");
        const sql = postgres(opts.databaseUrl);
        for (const stmt of ddl("SERIAL PRIMARY KEY")) await sql.unsafe(stmt);
        const db = drizzle(sql);
        return {
            makeBackend: (sessionId) => new DrizzleBackend(db, pgSchema, sessionId),
            close: async () => { await sql.end(); },
        };
    }

    // SQLite via libsql (async, pure-JS, file-backed for local dev).
    const dbPath = opts.dbPath ?? path.join("workspace", "vibes.db");
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    const { createClient } = await import("@libsql/client");
    const { drizzle } = await import("drizzle-orm/libsql");
    const client = createClient({ url: `file:${path.resolve(dbPath)}` });
    for (const stmt of ddl("INTEGER PRIMARY KEY AUTOINCREMENT")) await client.execute(stmt);
    const db = drizzle(client);
    return {
        // The SQLite schema is structurally parallel to the Postgres one; cast
        // it to the canonical type the shared backend is written against.
        makeBackend: (sessionId) => new DrizzleBackend(db, sqliteSchema as unknown as typeof pgSchema, sessionId),
        close: async () => { client.close(); },
    };
}
