import type { VibesDataParts } from 'harness-vibes';

// Animation configuration for all data parts
export const animationProps = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

// Type exports
export type NotificationData = VibesDataParts['notification'];
export type StatusData = VibesDataParts['status'] & {
  plugin?: string;
  agentName?: string;
  delegationId?: string;
  operationId?: string;
  parentOperationId?: string;
  phase?: string;
};
export type ReasoningModeData = VibesDataParts['reasoning_mode'];
export type TodoUpdateData = VibesDataParts['todo_update'];
export type TaskUpdateData = VibesDataParts['task_update'];
export type TaskGraphData = VibesDataParts['task_graph'];
export type SummarizationData = VibesDataParts['summarization'];
export type ToolProgressData = VibesDataParts['tool_progress'] & {
  message?: string;
  plugin?: string;
  agentName?: string;
  delegationId?: string;
  operationId?: string;
  parentOperationId?: string;
  attempt?: number;
  elapsedMs?: number;
};
export type ErrorData = VibesDataParts['error'] & {
  plugin?: string;
  agentName?: string;
  delegationId?: string;
  operationId?: string;
  parentOperationId?: string;
  attempt?: number;
};
export type MemoryUpdateData = VibesDataParts['memory_update'];
export type SwarmSignalData = VibesDataParts['swarm_signal'];
export type DelegationData = VibesDataParts['delegation'];

// Configuration objects for consistent styling
export const notificationConfig = {
  info: {
    icon: 'Info',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-900/50',
  },
  warning: {
    icon: 'AlertTriangle',
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-900/50',
  },
  error: {
    icon: 'AlertCircle',
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-900/50',
  },
} as const;

export const reasoningConfig = {
  react: {
    icon: 'RefreshCw',
    label: 'ReAct',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-900/50',
  },
  tot: {
    icon: 'TreePine',
    label: 'Tree-of-Thoughts',
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-950/30',
    border: 'border-purple-200 dark:border-purple-900/50',
  },
  'plan-execute': {
    icon: 'ClipboardList',
    label: 'Plan-Execute',
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-900/50',
  },
} as const;

export const todoStatusConfig = {
  pending: {
    icon: 'Clock',
    color: 'text-zinc-500 dark:text-zinc-400',
    spin: false,
  },
  in_progress: {
    icon: 'Loader2',
    color: 'text-amber-600 dark:text-amber-400',
    spin: true,
  },
  completed: {
    icon: 'CheckCircle2',
    color: 'text-emerald-600 dark:text-emerald-400',
    spin: false,
  },
} as const;

export const taskStatusConfig = {
  pending: {
    icon: 'Clock',
    bg: 'bg-zinc-100 dark:bg-zinc-800/50',
    border: 'border-zinc-300 dark:border-zinc-700',
    text: 'text-zinc-600 dark:text-zinc-400',
    spin: false,
  },
  blocked: {
    icon: 'X',
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-900/50',
    text: 'text-red-600 dark:text-red-400',
    spin: false,
  },
  in_progress: {
    icon: 'Loader2',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-900/50',
    text: 'text-amber-600 dark:text-amber-400',
    spin: true,
  },
  completed: {
    icon: 'CheckCircle2',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-200 dark:border-emerald-900/50',
    text: 'text-emerald-600 dark:text-emerald-400',
    spin: false,
  },
  failed: {
    icon: 'AlertCircle',
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-900/50',
    text: 'text-red-600 dark:text-red-400',
    spin: false,
  },
} as const;

export const priorityConfig = {
  low: { bg: 'bg-emerald-500 dark:bg-emerald-600', text: 'text-white' },
  medium: { bg: 'bg-amber-500 dark:bg-amber-600', text: 'text-white' },
  high: { bg: 'bg-orange-500 dark:bg-orange-600', text: 'text-white' },
  critical: { bg: 'bg-red-500 dark:bg-red-600', text: 'text-white' },
} as const;

export const summarizationConfig = {
  starting: { label: 'Starting...', icon: 'Database', spin: false },
  in_progress: { label: 'Compressing...', icon: 'Loader2', spin: true },
  complete: { label: 'Complete', icon: 'CheckCircle2', spin: false },
  failed: { label: 'Failed', icon: 'AlertCircle', spin: false },
} as const;

export const toolStageConfig = {
  starting: { label: 'Starting', icon: 'Activity', spin: false },
  in_progress: { label: 'Running', icon: 'Loader2', spin: true },
  complete: { label: 'Complete', icon: 'CheckCircle2', spin: false },
  failed: { label: 'Failed', icon: 'AlertCircle', spin: false },
} as const;

export const memoryTypeConfig = {
  lesson: { icon: 'Lightbulb', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30' },
  fact: { icon: 'FileText', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/30' },
  pattern: { icon: 'Network', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
} as const;

export const memoryActionConfig = {
  saved: { label: 'saved', color: 'text-emerald-600 dark:text-emerald-400' },
  updated: { label: 'updated', color: 'text-blue-600 dark:text-blue-400' },
  deleted: { label: 'deleted', color: 'text-red-600 dark:text-red-400' },
} as const;

export const delegationConfig = {
  starting: { icon: 'Activity', bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-900/50', text: 'text-blue-600 dark:text-blue-400', spin: false },
  in_progress: { icon: 'Loader2', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-900/50', text: 'text-amber-600 dark:text-amber-400', spin: true },
  complete: { icon: 'CheckCircle2', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-900/50', text: 'text-emerald-600 dark:text-emerald-400', spin: false },
  failed: { icon: 'AlertCircle', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-900/50', text: 'text-red-600 dark:text-red-400', spin: false },
} as const;
