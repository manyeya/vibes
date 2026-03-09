import type { AgentState } from '../core/types';
import {
    SqliteSessionRepository,
    type SessionInfo,
    type SessionUpdate,
} from './sqlite-session-repository';
import { SqliteAgentStateStore } from './sqlite-agent-state-store';

export default class SqliteBackend {
    private readonly repository: SqliteSessionRepository;
    private readonly stateStore: SqliteAgentStateStore;

    constructor(
        dbPath: string = 'workspace/vibes.db',
        sessionId: string = 'default',
    ) {
        this.repository = new SqliteSessionRepository(dbPath);
        this.stateStore = new SqliteAgentStateStore(dbPath, sessionId);
    }

    getState(): AgentState {
        return this.stateStore.getState();
    }

    setState(state: Partial<AgentState>): void {
        this.stateStore.setState(state);
    }

    async listSessions(): Promise<SessionInfo[]> {
        return this.repository.listSessions();
    }

    async getSession(sessionId: string): Promise<SessionInfo | null> {
        return this.repository.getSession(sessionId);
    }

    async createSession(
        title?: string,
        metadata: Record<string, any> = {},
    ): Promise<string> {
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        await this.repository.createSession(sessionId, { title, metadata });
        return sessionId;
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.repository.deleteSession(sessionId);
    }

    async updateSession(sessionId: string, updates: SessionUpdate): Promise<void> {
        await this.repository.updateSession(sessionId, updates);
    }

    close(): void {
        this.stateStore.close();
        this.repository.close();
    }
}
