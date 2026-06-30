import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { connectStore, type StoreConnection } from '../src/storage/connect';

// Each test gets its own throwaway db file + connection.
const dbs: string[] = [];
const conns: StoreConnection[] = [];
function freshDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vibes-backend-'));
  dbs.push(dir);
  return join(dir, 'vibes.db');
}
async function open(dbPath: string): Promise<StoreConnection> {
  const conn = await connectStore({ dbPath });
  conns.push(conn);
  return conn;
}
afterEach(async () => {
  while (conns.length) await conns.pop()!.close();
  while (dbs.length) rmSync(dbs.pop()!, { recursive: true, force: true });
});

describe('Session usage persistence (C2 — no clobber)', () => {
  test('updateSession MERGES metadata, preserving stream-written usage', async () => {
    const conn = await open(freshDb());
    const backend = conn.makeBackend('default');
    const id = await backend.createSession('My session', {}, undefined);

    // The streaming path writes token usage straight to sessions.metadata.
    const sess = conn.makeBackend(id);
    await sess.setState({ metadata: { usage: { inputTokens: 300, outputTokens: 50, totalTokens: 350 }, lastStreamAt: 't0' } });

    // The session manager later persists title/metadata from an in-memory copy
    // that knows nothing about usage. This must NOT drop usage.
    await backend.updateSession(id, { title: 'Renamed', metadata: { workspaceDir: '/tmp/x' } });

    const after = await backend.getSession(id);
    expect(after?.metadata?.usage).toEqual({ inputTokens: 300, outputTokens: 50, totalTokens: 350 });
    expect(after?.metadata?.workspaceDir).toBe('/tmp/x'); // caller's key applied
    expect(after?.metadata?.title).toBe('Renamed');
  });

  test('setState merges usage onto prior metadata across streams (cumulative)', async () => {
    const conn = await open(freshDb());
    const root = conn.makeBackend('default');
    const id = await root.createSession('s', {}, undefined);
    const sess = conn.makeBackend(id);

    // Stream 1.
    let prior = await sess.getState();
    await sess.setState({ metadata: { ...(prior.metadata ?? {}), usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } } });
    // Stream 2 (caller accumulates, as stream-response does).
    prior = await sess.getState();
    const p = prior.metadata!.usage as { inputTokens: number; outputTokens: number; totalTokens: number };
    await sess.setState({ metadata: { ...prior.metadata, usage: { inputTokens: p.inputTokens + 200, outputTokens: p.outputTokens + 30, totalTokens: p.totalTokens + 230 } } });

    const after = await sess.getState();
    expect(after.metadata!.usage).toEqual({ inputTokens: 300, outputTokens: 50, totalTokens: 350 });
  });
});
