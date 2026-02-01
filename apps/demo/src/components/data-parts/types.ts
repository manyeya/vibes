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
export type StatusData = VibesDataParts['status'];
export type ReasoningModeData = VibesDataParts['reasoning_mode'];
export type TodoUpdateData = VibesDataParts['todo_update'];
export type TaskUpdateData = VibesDataParts['task_update'];
export type TaskGraphData = VibesDataParts['task_graph'];
export type SummarizationData = VibesDataParts['summarization'];
export type ToolProgressData = VibesDataParts['tool_progress'];
export type ErrorData = VibesDataParts['error'];
export type MemoryUpdateData = VibesDataParts['memory_update'];
export type SwarmSignalData = VibesDataParts['swarm_signal'];
export type DelegationData = VibesDataParts['delegation'];

// Configuration objects for consistent styling
export const notificationConfig = {
  info: {
    icon: 'Info',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
  },
  warning: {
    icon: 'AlertTriangle',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
  },
  error: {
    icon: 'AlertCircle',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
  },
} as const;

export const reasoningConfig = {
  react: {
    icon: 'RefreshCw',
    label: 'ReAct',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/20',
  },
  tot: {
    icon: 'TreePine',
    label: 'Tree-of-Thoughts',
    color: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/20',
  },
  'plan-execute': {
    icon: 'ClipboardList',
    label: 'Plan-Execute',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
  },
} as const;

export const todoStatusConfig = {
  pending: {
    icon: 'Clock',
    color: 'text-zinc-400',
    spin: false,
  },
  in_progress: {
    icon: 'Loader2',
    color: 'text-yellow-400',
    spin: true,
  },
  completed: {
    icon: 'CheckCircle2',
    color: 'text-emerald-400',
    spin: false,
  },
} as const;

export const taskStatusConfig = {
  pending: {
    icon: 'Clock',
    bg: 'bg-zinc-800/50',
    border: 'border-zinc-700',
    text: 'text-zinc-400',
    spin: false,
  },
  blocked: {
    icon: 'X',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    text: 'text-red-400',
    spin: false,
  },
  in_progress: {
    icon: 'Loader2',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
    text: 'text-yellow-400',
    spin: true,
  },
  completed: {
    icon: 'CheckCircle2',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    text: 'text-emerald-400',
    spin: false,
  },
  failed: {
    icon: 'AlertCircle',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    text: 'text-red-400',
    spin: false,
  },
} as const;

export const priorityConfig = {
  low: { bg: 'bg-emerald-500', text: 'text-emerald-400' },
  medium: { bg: 'bg-yellow-500', text: 'text-yellow-400' },
  high: { bg: 'bg-orange-500', text: 'text-orange-400' },
  critical: { bg: 'bg-red-500', text: 'text-red-400' },
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
  lesson: { icon: 'Lightbulb', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  fact: { icon: 'FileText', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  pattern: { icon: 'Network', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
} as const;

export const memoryActionConfig = {
  saved: { label: 'saved', color: 'text-emerald-400' },
  updated: { label: 'updated', color: 'text-blue-400' },
  deleted: { label: 'deleted', color: 'text-red-400' },
} as const;

export const delegationConfig = {
  starting: { icon: 'Activity', bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400', spin: false },
  in_progress: { icon: 'Loader2', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', text: 'text-yellow-400', spin: true },
  complete: { icon: 'CheckCircle2', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', spin: false },
  failed: { icon: 'AlertCircle', bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400', spin: false },
} as const;
