import type { Database } from 'bun:sqlite';
import { openSqliteDatabase, parseJsonObject } from './sqlite-common';

export interface SessionInfo {
    id: string;
    summary?: string;
    metadata?: Record<string, any>;
    createdAt?: string;
    updatedAt?: string;
    messageCount?: number;
}

export interface SessionUpdate {
    title?: string;
    summary?: string;
    metadata?: Record<string, any>;
}

export interface SessionCreateInput extends SessionUpdate {
    createdAt?: string;
    updatedAt?: string;
}

export class SqliteSessionRepository {
    private readonly db: Database;

    constructor(dbPath: string = 'workspace/vibes.db') {
        this.db = openSqliteDatabase(dbPath);
    }

    async listSessions(): Promise<SessionInfo[]> {
        const sessions = this.db.query(`
            SELECT s.id, s.summary, s.metadata, s.created_at, s.updated_at,
                   COUNT(DISTINCT m.id) as message_count
            FROM sessions s
            LEFT JOIN messages m ON s.id = m.session_id
            GROUP BY s.id
            ORDER BY s.updated_at DESC
        `).all() as any[];

        return sessions.map((row) => this.toSessionInfo(row));
    }

    async getSession(sessionId: string): Promise<SessionInfo | null> {
        const row = this.db.query(`
            SELECT s.id, s.summary, s.metadata, s.created_at, s.updated_at,
                   COUNT(DISTINCT m.id) as message_count
            FROM sessions s
            LEFT JOIN messages m ON s.id = m.session_id
            WHERE s.id = ?
            GROUP BY s.id
        `).get(sessionId) as any;

        return row ? this.toSessionInfo(row) : null;
    }

    async createSession(sessionId: string, input: SessionCreateInput = {}): Promise<string> {
        const now = new Date().toISOString();
        const metadata = this.mergeMetadata({}, input.metadata, input.title);

        this.db.run(
            `
                INSERT INTO sessions (id, summary, metadata, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
            `,
            [
                sessionId,
                input.summary ?? null,
                JSON.stringify(metadata),
                input.createdAt ?? now,
                input.updatedAt ?? now,
            ],
        );

        return sessionId;
    }

    async updateSession(sessionId: string, updates: SessionUpdate): Promise<void> {
        const current = await this.getSession(sessionId);
        if (!current) {
            return;
        }

        const now = new Date().toISOString();
        const metadata = this.mergeMetadata(current.metadata, updates.metadata, updates.title);

        this.db.run(
            `
                UPDATE sessions
                SET summary = ?, metadata = ?, updated_at = ?
                WHERE id = ?
            `,
            [
                updates.summary !== undefined ? updates.summary : current.summary ?? null,
                JSON.stringify(metadata),
                now,
                sessionId,
            ],
        );
    }

    async deleteSession(sessionId: string): Promise<void> {
        this.db.transaction(() => {
            this.db.run('DELETE FROM messages WHERE session_id = ?', [sessionId]);
            this.db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
        })();
    }

    close(): void {
        this.db.close();
    }

    private toSessionInfo(row: any): SessionInfo {
        return {
            id: row.id,
            summary: row.summary || undefined,
            metadata: parseJsonObject(row.metadata),
            createdAt: row.created_at || undefined,
            updatedAt: row.updated_at || undefined,
            messageCount: row.message_count || 0,
        };
    }

    private mergeMetadata(
        current: Record<string, any> | undefined,
        updates: Record<string, any> | undefined,
        title?: string,
    ): Record<string, any> {
        const metadata = { ...(current || {}), ...(updates || {}) };

        if (title !== undefined) {
            metadata.title = title;
        }

        return metadata;
    }
}
