import type { UIMessage } from 'ai';

export const API_URL = process.env.VIBES_API_URL ?? 'http://localhost:3000';

export interface SessionInfo {
  id: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
  workspaceId?: string;
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

export interface WorkspaceInfo {
  id: string;
  name: string;
  /** The project directory shared by the workspace's sessions. */
  rootDir: string;
  sessionCount?: number;
  updatedAt?: string;
}

export interface GitInfo {
  branch: string;
  dirty: boolean;
}

/** Git branch + dirty state of a workspace's project dir, or null if not a repo. */
export const getWorkspaceGit = (id: string) =>
  api<{ git: GitInfo | null }>(`/workspaces/${id}/git`).then((r) => r.git);

export const listWorkspaces = () =>
  api<{ workspaces: WorkspaceInfo[] }>('/workspaces').then((r) => r.workspaces);

/** Create a workspace: `rootDir` opens an existing folder, `name` makes a fresh project dir. */
export const createWorkspace = (opts: { name?: string; rootDir?: string }) =>
  api<{ workspace: WorkspaceInfo }>('/workspaces', {
    method: 'POST',
    body: JSON.stringify(opts),
  }).then((r) => r.workspace);

/**
 * Open a folder as the active workspace, reusing an existing one for that path.
 * Used by the `vibes` CLI (via VIBES_PROJECT_DIR) to land straight in the repo
 * the user launched from, without accumulating a duplicate per launch.
 */
export const openProject = async (rootDir: string): Promise<WorkspaceInfo> => {
  const existing = (await listWorkspaces()).find((w) => w.rootDir === rootDir);
  return existing ?? createWorkspace({ rootDir });
};

export const listSessions = (workspaceId?: string) =>
  api<{ sessions: SessionInfo[] }>(
    workspaceId ? `/sessions?workspace_id=${encodeURIComponent(workspaceId)}` : '/sessions',
  ).then((r) => r.sessions);

export const createSession = (opts: { title?: string; workspaceId?: string } = {}) =>
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

export type WorkflowInputType = 'string' | 'number' | 'boolean' | 'array' | 'json';

/** A declared workflow input — mirrors harness-vibes WorkflowPlugin JSON. */
export interface WorkflowInput {
  name: string;
  description?: string;
  required?: boolean;
  type?: WorkflowInputType;
  enum?: string[];
  default?: string | number | boolean;
}

export interface WorkflowInfo {
  id: string;
  name: string;
  description?: string;
  /** Declared inputs the run form collects (see WorkflowRunForm). */
  inputs?: WorkflowInput[];
}

/** Saved workflows (WorkflowPlugin library). */
export const getWorkflows = () =>
  api<{ workflows: WorkflowInfo[] }>('/workflows').then((r) => r.workflows ?? []);

/**
 * Run a saved workflow directly (bypassing the agent). The server registers a
 * resumable stream and returns its id; the caller tails it via useChat's
 * `resumeStream()`. Same endpoint the web demo's WorkflowRunForm posts to.
 */
export const runWorkflow = (sessionId: string, nameOrId: string, inputs: Record<string, unknown>, model?: string) =>
  api<{ streamId: string }>(`/vibe/${sessionId}/workflows/${encodeURIComponent(nameOrId)}/run`, {
    method: 'POST',
    body: JSON.stringify({ inputs, model: model || undefined }),
  });
