import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HarnessSessionManager } from '../src/core/session-manager';
import type { VibeAgent } from '../src/core/agent';
import { createTempWorkspace, removeTempWorkspace } from './helpers';

describe('HarnessSessionManager', () => {
    let rootDir: string;
    let dbPath: string;
    let sessionsDir: string;

    beforeEach(async () => {
        rootDir = await createTempWorkspace('harness-vibes-session-manager');
        dbPath = join(rootDir, 'vibes.db');
        sessionsDir = join(rootDir, 'sessions');
    });

    afterEach(async () => {
        await removeTempWorkspace(rootDir);
    });

    test('ensureSession creates workspace and persists metadata without creating ghost sessions', async () => {
        const manager = new HarnessSessionManager({
            dbPath,
            sessionsDir,
        });

        expect(await manager.getSessionInfo('missing')).toBeNull();
        expect(await manager.listSessions()).toEqual([]);

        const session = await manager.ensureSession({
            id: 'session-1',
            title: 'Inbox',
            metadata: { source: 'api' },
        });

        expect(session.id).toBe('session-1');
        expect(session.metadata).toMatchObject({
            title: 'Inbox',
            source: 'api',
            workspaceDir: join(sessionsDir, 'session-1'),
        });
        expect(manager.sessionWorkspaceExists('session-1')).toBe(true);
    });

    test('getOrCreateSession uses the configured agentFactory', async () => {
        const agentCalls: Array<{ sessionId: string; workspaceDir: string }> = [];
        const agent = { kind: 'test-agent' } as unknown as VibeAgent;
        const manager = new HarnessSessionManager({
            dbPath,
            sessionsDir,
            agentFactory: ({ sessionId, workspaceDir }) => {
                agentCalls.push({ sessionId, workspaceDir });
                return agent;
            },
        });

        const session = await manager.getOrCreateSession({
            id: 'session-2',
            title: 'Execution',
        });

        expect(session.agent).toBe(agent);
        expect(agentCalls).toEqual([
            {
                sessionId: 'session-2',
                workspaceDir: join(sessionsDir, 'session-2'),
            },
        ]);
        expect(session.metadata).toMatchObject({
            title: 'Execution',
            workspaceDir: join(sessionsDir, 'session-2'),
        });
    });

    test('cleanup with deleteData waits for database and workspace deletion', async () => {
        const manager = new HarnessSessionManager({
            dbPath,
            sessionsDir,
            agentFactory: () => ({ kind: 'cleanup-agent' } as unknown as VibeAgent),
        });

        await manager.getOrCreateSession({ id: 'stale-session' });
        const workspaceDir = manager.getSessionWorkspace('stale-session');
        await writeFile(join(workspaceDir, 'note.txt'), 'hello');

        const loaded = manager.getSession('stale-session');
        if (!loaded) {
            throw new Error('Expected a loaded session');
        }
        loaded.lastAccessed = 0;

        const result = await manager.cleanup({ maxAge: 1, deleteData: true });

        expect(result).toEqual({ unloaded: [], deleted: ['stale-session'] });
        expect(await manager.getSessionInfo('stale-session')).toBeNull();
        expect(manager.sessionWorkspaceExists('stale-session')).toBe(false);
        expect(existsSync(workspaceDir)).toBe(false);
    });

    test('export and import round-trip session archives for same and new ids', async () => {
        const manager = new HarnessSessionManager({
            dbPath,
            sessionsDir,
        });

        await manager.ensureSession({ id: 'session-export', metadata: { tag: 'original' } });
        const exportWorkspace = manager.getSessionWorkspace('session-export');
        await writeFile(join(exportWorkspace, 'scratchpad.md'), 'exported session');

        const archive = await manager.exportSession('session-export');
        const archiveData = await archive.arrayBuffer();

        await manager.deleteSession('session-export');
        const restoredId = await manager.importSession(archiveData, 'session-export');
        const restoredContents = await readFile(
            join(manager.getSessionWorkspace(restoredId), 'scratchpad.md'),
            'utf8',
        );

        expect(restoredId).toBe('session-export');
        expect(restoredContents).toBe('exported session');
        expect((await manager.getSessionInfo('session-export'))?.metadata).toMatchObject({
            workspaceDir: join(sessionsDir, 'session-export'),
        });

        const secondArchive = await manager.exportSession('session-export');
        const secondArchiveData = await secondArchive.arrayBuffer();
        const copiedId = await manager.importSession(secondArchiveData, 'session-copy');
        const copiedContents = await readFile(
            join(manager.getSessionWorkspace(copiedId), 'scratchpad.md'),
            'utf8',
        );

        expect(copiedId).toBe('session-copy');
        expect(copiedContents).toBe('exported session');
        expect((await manager.getSessionInfo('session-copy'))?.metadata).toMatchObject({
            workspaceDir: join(sessionsDir, 'session-copy'),
        });
    });
});
