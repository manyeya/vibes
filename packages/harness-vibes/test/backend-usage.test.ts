import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import SqliteBackend from '../src/backend/sqlite-backend';

// Each test gets its own throwaway db file.
const dbs: string[] = [];
function freshDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vibes-backend-'));
  const path = join(dir, 'vibes.db');
  dbs.push(dir);
  return path;
}
afterEach(() => { while (dbs.length) rmSync(dbs.pop()!, { recursive: true, force: true }); });

describe('Session usage persistence (C2 — no clobber)', () => {
  test('updateSession MERGES metadata, preserving stream-written usage', async () => {
    const dbPath = freshDb();
    const backend = new SqliteBackend(dbPath, 'default');
    const id = await backend.createSession('My session', {}, undefined);

    // The streaming path writes token usage straight to sessions.metadata.
    const sess = new SqliteBackend(dbPath, id);
    sess.setState({ metadata: { usage: { inputTokens: 300, outputTokens: 50, totalTokens: 350 }, lastStreamAt: 't0' } });

    // The session manager later persists title/metadata from an in-memory copy
    // that knows nothing about usage. This must NOT drop usage.
    await backend.updateSession(id, { title: 'Renamed', metadata: { workspaceDir: '/tmp/x' } });

    const after = await backend.getSession(id);
    expect(after?.metadata?.usage).toEqual({ inputTokens: 300, outputTokens: 50, totalTokens: 350 });
    expect(after?.metadata?.workspaceDir).toBe('/tmp/x'); // caller's key applied
    expect(after?.metadata?.title).toBe('Renamed');

    sess.close();
    backend.close();
  });

  test('setState merges usage onto prior metadata across streams (cumulative)', async () => {
    const dbPath = freshDb();
    const root = new SqliteBackend(dbPath, 'default');
    const id = await root.createSession('s', {}, undefined);
    const sess = new SqliteBackend(dbPath, id);

    // Stream 1.
    let prior = sess.getState();
    sess.setState({ metadata: { ...(prior.metadata ?? {}), usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } } });
    // Stream 2 (caller accumulates, as stream-response does).
    prior = sess.getState();
    const p = prior.metadata!.usage as { inputTokens: number; outputTokens: number; totalTokens: number };
    sess.setState({ metadata: { ...prior.metadata, usage: { inputTokens: p.inputTokens + 200, outputTokens: p.outputTokens + 30, totalTokens: p.totalTokens + 230 } } });

    const after = sess.getState();
    expect(after.metadata!.usage).toEqual({ inputTokens: 300, outputTokens: 50, totalTokens: 350 });
    sess.close();
    root.close();
  });
});
