import type { VibesDataParts } from 'harness-vibes';

// Re-export data part types
export type {
  VibesDataParts,
  DataStreamWriter,
} from 'harness-vibes';

// Session types
export interface Session {
  id: string;
  metadata?: { title?: string };
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  taskCount: number;
  fileCount: number;
}

// Task types
export interface Task {
  id: string;
  title: string;
  status: 'pending' | 'blocked' | 'in_progress' | 'completed' | 'failed';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  error?: string;
}

// Agent status types
export interface AgentStatus {
  reasoningMode: 'react' | 'tot' | 'plan-execute';
  isProcessing: boolean;
  tokenCount: number;
  tasks: Task[];
  lessonsLearned: number;
  factsStored: number;
  patternsCount: number;
}

// Message parts from streaming
export type DataPartType = keyof VibesDataParts;

export interface DataPart<T extends DataPartType = DataPartType> {
  type: `data-${T}`;
  data: VibesDataParts[T];
}

// Reasoning mode
export type ReasoningMode = AgentStatus['reasoningMode'];

// Task status
export type TaskStatus = Task['status'];

// Priority level
export type Priority = Task['priority'];

// Notification level
export type NotificationLevel = 'info' | 'warning' | 'error';

// Summarization stage
export type SummarizationStage = 'starting' | 'in_progress' | 'complete' | 'failed';

// Tool stage
export type ToolStage = 'starting' | 'in_progress' | 'complete' | 'failed';

// Memory type
export type MemoryType = 'lesson' | 'fact' | 'pattern';

// Memory action
export type MemoryAction = 'saved' | 'updated' | 'deleted';

// Delegation status
export type DelegationStatus = 'starting' | 'in_progress' | 'complete' | 'failed';
