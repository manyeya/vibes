// Workspace (project) shapes shared between App, the switcher, and the
// Workspaces page. A workspace groups multiple sessions that share one project
// directory (`rootDir`).

export interface Workspace {
  id: string;
  name: string;
  /** App-managed project directory shared by the workspace's sessions. */
  rootDir: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  /** Number of sessions in this workspace. */
  sessionCount?: number;
}
