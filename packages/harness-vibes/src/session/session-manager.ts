import * as path from 'node:path';
import type { UIMessageStreamWriter } from 'ai';
import { VibeAgent } from '../core/agent';
import type { VibeAgentConfig, VibesUIMessage } from '../core/types';
import SqliteBackend from '../persistence/sqlite-backend';
import {
    SqliteSessionRepository,
    type SessionInfo,
} from '../persistence/sqlite-session-repository';
import { SessionWorkspaceStore } from './session-workspace';

const WORKSPACE_ROOT = 'workspace';
const SESSIONS_DIR = path.join(WORKSPACE_ROOT, 'sessions');

export interface SessionConfig {
    id?: string;
    title?: string;
    metadata?: Record<string, any>;
    sessionsDir?: string;
}

export interface SessionAgentConfig extends Partial<VibeAgentConfig> {
    workspaceDir?: string;
}

export interface SessionInstance {
    id: string;
    agent: VibeAgent;
    backend: SqliteBackend;
    workspaceDir: string;
    lastAccessed: number;
    writer?: UIMessageStreamWriter<VibesUIMessage>;
    metadata: Record<string, any>;
    title?: string;
    createdAt: Date;
}

export interface CleanupOptions {
    maxAge?: number;
    deleteData?: boolean;
}

interface HarnessSessionManagerConfig {
    dbPath?: string;
    sessionsDir?: string;
    defaultAgentConfig?: SessionAgentConfig;
    agentFactory?: (config: { sessionId: string; workspaceDir: string }) => VibeAgent;
}

export class HarnessSessionManager {
    private readonly sessions = new Map<string, SessionInstance>();
    private readonly dbPath: string;
    private readonly defaultAgentConfig?: SessionAgentConfig;
    private readonly agentFactory?: (config: { sessionId: string; workspaceDir: string }) => VibeAgent;
    private readonly sessionRepository: SqliteSessionRepository;
    private readonly workspaceStore: SessionWorkspaceStore;
    private readonly ready: Promise<void>;

    constructor(config?: HarnessSessionManagerConfig) {
        this.dbPath = config?.dbPath || path.join(WORKSPACE_ROOT, 'vibes.db');
        this.defaultAgentConfig = config?.defaultAgentConfig;
        this.agentFactory = config?.agentFactory;
        this.sessionRepository = new SqliteSessionRepository(this.dbPath);
        this.workspaceStore = new SessionWorkspaceStore(config?.sessionsDir || SESSIONS_DIR);
        this.ready = this.workspaceStore.ensureBaseDirectory();
    }

    async ensureSession(config: SessionConfig = {}): Promise<SessionInfo> {
        await this.ready;

        const sessionId = config.id || this.generateSessionId();
        const workspaceDir = await this.workspaceStore.ensure(sessionId);
        const current = await this.sessionRepository.getSession(sessionId);

        if (!current) {
            await this.sessionRepository.createSession(sessionId, {
                title: config.title,
                metadata: this.mergeMetadata(undefined, config.metadata, config.title, workspaceDir),
            });
        } else {
            const mergedMetadata = this.mergeMetadata(
                current.metadata,
                config.metadata,
                config.title,
                workspaceDir,
            );
            const needsMetadataUpdate = JSON.stringify(mergedMetadata) !== JSON.stringify(current.metadata || {});
            const needsSummaryUpdate = false;

            if (needsMetadataUpdate || needsSummaryUpdate) {
                await this.sessionRepository.updateSession(sessionId, {
                    title: config.title,
                    metadata: mergedMetadata,
                });
            }
        }

        const ensured = await this.sessionRepository.getSession(sessionId);
        if (!ensured) {
            throw new Error(`Failed to ensure session ${sessionId}`);
        }

        const loaded = this.sessions.get(sessionId);
        if (loaded) {
            loaded.metadata = ensured.metadata || {};
            loaded.title = this.extractTitle(ensured);
        }

        return ensured;
    }

    async getOrCreateSession(config: SessionConfig = {}): Promise<SessionInstance> {
        const sessionId = config.id || this.generateSessionId();
        const existing = this.sessions.get(sessionId);

        if (existing) {
            existing.lastAccessed = Date.now();

            if (config.metadata || config.title) {
                const ensured = await this.ensureSession({ ...config, id: sessionId });
                existing.metadata = ensured.metadata || {};
                existing.title = this.extractTitle(ensured);
            }

            return existing;
        }

        const ensured = await this.ensureSession({ ...config, id: sessionId });
        const workspaceDir = this.getSessionWorkspace(sessionId);
        const agent = this.createAgent(sessionId, workspaceDir);
        const backend = new SqliteBackend(this.dbPath, sessionId);
        const createdAt = ensured.createdAt ? new Date(ensured.createdAt) : new Date();

        const instance: SessionInstance = {
            id: sessionId,
            agent,
            backend,
            workspaceDir,
            lastAccessed: Date.now(),
            metadata: ensured.metadata || {},
            title: this.extractTitle(ensured),
            createdAt,
        };

        this.sessions.set(sessionId, instance);
        return instance;
    }

    getSession(sessionId: string): SessionInstance | undefined {
        return this.sessions.get(sessionId);
    }

    unloadSession(sessionId: string): boolean {
        const instance = this.sessions.get(sessionId);
        if (!instance) {
            return false;
        }

        instance.backend.close();
        return this.sessions.delete(sessionId);
    }

    async deleteSession(sessionId: string): Promise<void> {
        this.unloadSession(sessionId);
        await this.ready;
        await this.sessionRepository.deleteSession(sessionId);
        await this.workspaceStore.delete(sessionId);
    }

    async listSessions(): Promise<SessionInfo[]> {
        return this.sessionRepository.listSessions();
    }

    async getSessionInfo(sessionId: string): Promise<SessionInfo | null> {
        return this.sessionRepository.getSession(sessionId);
    }

    async updateSession(
        sessionId: string,
        updates: {
            title?: string;
            summary?: string;
            metadata?: Record<string, any>;
        },
    ): Promise<void> {
        await this.ready;

        const current = await this.sessionRepository.getSession(sessionId);
        if (!current) {
            return;
        }

        await this.sessionRepository.updateSession(sessionId, {
            title: updates.title,
            summary: updates.summary,
            metadata: this.mergeMetadata(
                current.metadata,
                updates.metadata,
                updates.title,
                this.getSessionWorkspace(sessionId),
            ),
        });

        const loaded = this.sessions.get(sessionId);
        if (loaded) {
            loaded.metadata = {
                ...(loaded.metadata || {}),
                ...(updates.metadata || {}),
                workspaceDir: this.getSessionWorkspace(sessionId),
            };
            if (updates.title !== undefined) {
                loaded.title = updates.title;
                loaded.metadata.title = updates.title;
            }
        }
    }

    async cleanup(options: CleanupOptions = {}): Promise<{
        unloaded: string[];
        deleted: string[];
    }> {
        const maxAge = options.maxAge || 1000 * 60 * 30;
        const now = Date.now();
        const unloaded: string[] = [];
        const deleted: string[] = [];

        for (const [sessionId, instance] of this.sessions) {
            if (now - instance.lastAccessed <= maxAge) {
                continue;
            }

            if (options.deleteData) {
                await this.deleteSession(sessionId);
                deleted.push(sessionId);
            } else {
                this.unloadSession(sessionId);
                unloaded.push(sessionId);
            }
        }

        return { unloaded, deleted };
    }

    getLoadedSessions(): SessionInstance[] {
        return Array.from(this.sessions.values());
    }

    getLoadedSessionIds(): string[] {
        return Array.from(this.sessions.keys());
    }

    getSessionWorkspace(sessionId: string): string {
        return this.workspaceStore.getPath(sessionId);
    }

    sessionWorkspaceExists(sessionId: string): boolean {
        return this.workspaceStore.exists(sessionId);
    }

    async exportSession(sessionId: string): Promise<Blob> {
        return this.workspaceStore.export(sessionId);
    }

    async importSession(archiveData: ArrayBuffer, newSessionId?: string): Promise<string> {
        await this.ready;

        const sessionId = newSessionId || this.generateSessionId();
        await this.workspaceStore.import(archiveData, sessionId);
        await this.ensureSession({ id: sessionId });

        return sessionId;
    }

    private createAgent(sessionId: string, workspaceDir: string): VibeAgent {
        if (this.agentFactory) {
            return this.agentFactory({ sessionId, workspaceDir });
        }

        if (this.hasCompleteAgentConfig(this.defaultAgentConfig)) {
            return new VibeAgent({
                ...this.defaultAgentConfig,
                workspaceDir,
            });
        }

        throw new Error(
            'HarnessSessionManager.getOrCreateSession requires an agentFactory or a defaultAgentConfig with model and instructions. Use ensureSession() for session-only lifecycle management.',
        );
    }

    private hasCompleteAgentConfig(
        config?: SessionAgentConfig,
    ): config is SessionAgentConfig & Pick<VibeAgentConfig, 'model' | 'instructions'> {
        return Boolean(config?.model && config?.instructions);
    }

    private mergeMetadata(
        current: Record<string, any> | undefined,
        updates: Record<string, any> | undefined,
        title: string | undefined,
        workspaceDir: string,
    ): Record<string, any> {
        const metadata: Record<string, any> = {
            ...(current || {}),
            ...(updates || {}),
            workspaceDir,
        };

        if (title !== undefined) {
            metadata.title = title;
        }

        return metadata;
    }

    private extractTitle(session: SessionInfo): string | undefined {
        return typeof session.metadata?.title === 'string'
            ? session.metadata.title
            : undefined;
    }

    private generateSessionId(): string {
        return `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }
}

export const defaultSessionManager = new HarnessSessionManager();
