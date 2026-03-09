import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';

export function openSqliteDatabase(dbPath: string): Database {
    mkdirSync(path.dirname(dbPath), { recursive: true });

    const db = new Database(dbPath);
    ensureSchema(db);

    return db;
}

function ensureSchema(db: Database): void {
    db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            summary TEXT,
            metadata TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    `);

    try {
        db.run(`ALTER TABLE sessions ADD COLUMN created_at TEXT`);
        const now = new Date().toISOString();
        db.run(`UPDATE sessions SET created_at = ? WHERE created_at IS NULL`, [now]);
    } catch {
        // Column already exists.
    }

    try {
        db.run(`ALTER TABLE sessions ADD COLUMN updated_at TEXT`);
        const now = new Date().toISOString();
        db.run(`UPDATE sessions SET updated_at = ? WHERE updated_at IS NULL`, [now]);
    } catch {
        // Column already exists.
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            role TEXT,
            content TEXT,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_messages_session_id_id
        ON messages (session_id, id)
    `);
}

export function parseJsonObject(value: string | null | undefined): Record<string, any> {
    if (!value) {
        return {};
    }

    try {
        const parsed = JSON.parse(value);
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
        return {};
    }
}

export function parseMessageContent(value: string): unknown {
    if (!value.startsWith('[') && !value.startsWith('{')) {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}
