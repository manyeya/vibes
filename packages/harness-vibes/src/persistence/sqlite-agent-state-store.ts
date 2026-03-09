import type { Database } from 'bun:sqlite';
import type { AgentState } from '../core/types';
import { openSqliteDatabase, parseJsonObject, parseMessageContent } from './sqlite-common';

export class SqliteAgentStateStore {
    private readonly db: Database;
    private readonly sessionId: string;

    constructor(
        dbPath: string = 'workspace/vibes.db',
        sessionId: string = 'default',
    ) {
        this.db = openSqliteDatabase(dbPath);
        this.sessionId = sessionId;
    }

    getState(): AgentState {
        const session = this.db.query(
            'SELECT summary, metadata FROM sessions WHERE id = ?',
        ).get(this.sessionId) as any;
        const messages = this.db.query(
            'SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC',
        ).all(this.sessionId) as any[];

        return {
            messages: messages.map((message) => ({
                role: message.role,
                content: parseMessageContent(message.content),
            })) as any,
            metadata: parseJsonObject(session?.metadata),
            summary: session?.summary || undefined,
        };
    }

    setState(state: Partial<AgentState>): void {
        const now = new Date().toISOString();

        this.db.transaction(() => {
            this.db.run(
                `
                    INSERT OR IGNORE INTO sessions (id, metadata, created_at, updated_at)
                    VALUES (?, ?, ?, ?)
                `,
                [this.sessionId, JSON.stringify({}), now, now],
            );

            if (state.summary !== undefined) {
                this.db.run(
                    'UPDATE sessions SET summary = ?, updated_at = ? WHERE id = ?',
                    [state.summary, now, this.sessionId],
                );
            }

            if (state.metadata !== undefined) {
                this.db.run(
                    'UPDATE sessions SET metadata = ?, updated_at = ? WHERE id = ?',
                    [JSON.stringify(state.metadata), now, this.sessionId],
                );
            }

            if (state.summary === undefined && state.metadata === undefined) {
                this.db.run(
                    'UPDATE sessions SET updated_at = ? WHERE id = ?',
                    [now, this.sessionId],
                );
            }

            if (state.messages !== undefined) {
                this.db.run('DELETE FROM messages WHERE session_id = ?', [this.sessionId]);
                const insertMessage = this.db.prepare(
                    'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)',
                );

                for (const message of state.messages) {
                    insertMessage.run(
                        this.sessionId,
                        message.role,
                        typeof message.content === 'string'
                            ? message.content
                            : JSON.stringify(message.content),
                    );
                }
            }
        })();
    }

    close(): void {
        this.db.close();
    }
}
