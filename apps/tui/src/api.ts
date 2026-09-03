import type { UIMessage } from 'ai';

export const API_URL = process.env.VIBES_API_URL ?? 'http://localhost:3000';

export interface SessionInfo {
  id: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
  /** Directory this session works in. */
  cwd?: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const json = (await res.json()) as { success: boolean; error?: string } & T;
  if (!res.ok || json.success === false) {
    throw new Error(json.error ?? `${res.status} ${res.statusText}`);
  }
  return json;
}

export const health = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${API_URL}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
};

export interface GitInfo {
  branch: string;
  dirty: boolean;
}

/** Git branch + dirty state of a session's project dir, or null if not a repo. */
export const getSessionGit = (sessionId: string) =>
  api<{ git: GitInfo | null }>(`/sessions/${sessionId}/git`).then((r) => r.git);


export const listSessions = (cwd?: string) =>
  api<{ sessions: SessionInfo[] }>(
    cwd ? `/sessions?cwd=${encodeURIComponent(cwd)}` : '/sessions',
  ).then((r) => r.sessions);

export const createSession = (opts: { title?: string; cwd?: string } = {}) =>
  api<{ sessionId: string }>('/sessions', {
    method: 'POST',
    body: JSON.stringify(opts),
  }).then((r) => r.sessionId);

export const patchSession = (id: string, patch: { title?: string }) =>
  api(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteSession = (id: string) =>
  api(`/sessions/${id}`, { method: 'DELETE' });

export const abortSession = (id: string) =>
  api(`/sessions/${id}/abort`, { method: 'POST', body: JSON.stringify({}) });

export const getMessages = (id: string) =>
  api<{ messages: UIMessage[] }>(`/sessions/${id}/messages`).then((r) => r.messages);

export interface ModelInfo {
  id: string;
  group?: string;
}

export const getModels = () =>
  api<{ models: ModelInfo[]; active?: string }>('/models').then((r) => ({
    models: r.models ?? [],
    active: r.active,
  }));

export const shortModel = (id?: string) => id?.split('/').pop() ?? id;

export interface AgentInfo {
  name: string;
  description?: string;
}

/** The built-in sub-agent roster the slash palette can target work at. */
export const getAgents = () =>
  api<{ agents: AgentInfo[] }>('/agents').then((r) => r.agents ?? []);

export interface CheckpointInfo {
  id: string;
  sha: string;
  label: string;
  createdAt: string;
}

/** Restore points for this session, newest first. */
export const getCheckpoints = (sessionId: string) =>
  api<{ checkpoints: CheckpointInfo[] }>(`/sessions/${sessionId}/checkpoints`).then((r) => r.checkpoints ?? []);

/**
 * Rewind a session. `both` restores files AND truncates the conversation so the
 * agent's context matches what is on disk. Returns an undo sha — the rewind
 * itself is reversible.
 */
export const rewindSession = (
  sessionId: string,
  checkpointId: string,
  opts: { mode?: 'both' | 'files' | 'conversation'; messageCount?: number } = {},
) =>
  api<{ undoSha?: string; messagesKept?: number }>(`/sessions/${sessionId}/rewind`, {
    method: 'POST',
    body: JSON.stringify({ checkpointId, mode: opts.mode ?? 'both', messageCount: opts.messageCount ?? 0 }),
  });
