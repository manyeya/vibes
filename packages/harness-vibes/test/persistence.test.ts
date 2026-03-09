import SqliteBackend from '../src/backend/sqlitebackend';
import { SqliteAgentStateStore } from '../src/persistence/sqlite-agent-state-store';
import { SqliteSessionRepository } from '../src/persistence/sqlite-session-repository';
import { createTempWorkspace, removeTempWorkspace } from './helpers';

describe('persistence', () => {
    let rootDir: string;
    let dbPath: string;

    beforeEach(async () => {
        rootDir = await createTempWorkspace('harness-vibes-persistence');
        dbPath = `${rootDir}/vibes.db`;
    });

    afterEach(async () => {
        await removeTempWorkspace(rootDir);
    });

    test('compat backend constructor does not create ghost default sessions', async () => {
        const backend = new SqliteBackend(dbPath, 'default');

        expect(await backend.listSessions()).toEqual([]);
        expect(await backend.getSession('missing')).toBeNull();

        await backend.updateSession('missing', { title: 'ignored' });
        expect(await backend.listSessions()).toEqual([]);

        backend.close();
    });

    test('state store reads are side-effect free and writes upsert the session row', async () => {
        const repository = new SqliteSessionRepository(dbPath);
        const store = new SqliteAgentStateStore(dbPath, 'session-state');

        expect(store.getState()).toEqual({
            messages: [],
            metadata: {},
            summary: undefined,
        });
        expect(await repository.listSessions()).toEqual([]);

        store.setState({
            summary: 'hello',
            metadata: { source: 'test' },
            messages: [{ role: 'user', content: 'ping' }] as any,
        });

        const session = await repository.getSession('session-state');
        expect(session?.summary).toBe('hello');
        expect(session?.metadata).toMatchObject({ source: 'test' });

        repository.close();
        store.close();
    });

    test('repository persists initial title and metadata on explicit create', async () => {
        const repository = new SqliteSessionRepository(dbPath);

        await repository.createSession('session-1', {
            title: 'Planning session',
            metadata: { workspaceDir: '/tmp/work', owner: 'alice' },
        });

        const session = await repository.getSession('session-1');

        expect(session).not.toBeNull();
        expect(session?.metadata).toMatchObject({
            title: 'Planning session',
            workspaceDir: '/tmp/work',
            owner: 'alice',
        });

        repository.close();
    });
});
