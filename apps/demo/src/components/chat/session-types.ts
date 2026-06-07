// Session shapes shared between App, the sidebar, and the chat area.

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface Session {
  id: string;
  metadata?: { title?: string; usage?: SessionUsage };
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  taskCount: number;
  fileCount: number;
}
