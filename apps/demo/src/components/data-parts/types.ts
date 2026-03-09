import type { VibesDataParts } from 'harness-vibes';

export const animationProps = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

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

export const dataPartStyles = {
  chip:
    'inline-flex max-w-full items-center gap-1.5 rounded-[0.9rem] border px-2.5 py-1.5 text-[11px] leading-5 backdrop-blur-md',
  stack:
    'inline-flex max-w-full flex-col items-start gap-0.5 rounded-[0.9rem] border px-2.5 py-1.5 text-[11px] leading-5 backdrop-blur-md',
  panel:
    'max-w-full rounded-[0.95rem] border px-3 py-2.5 backdrop-blur-md',
  meta:
    'text-[10px] leading-4 text-[var(--tone-neutral-muted)]',
  label:
    'text-[9px] uppercase tracking-[0.22em] text-[var(--tone-neutral-muted)]',
} as const;

export const toneConfig = {
  neutral: {
    bg: 'bg-[var(--tone-neutral-bg)]',
    border: 'border-[var(--tone-neutral-border)]',
    text: 'text-[var(--tone-neutral-text)]',
    muted: 'text-[var(--tone-neutral-muted)]',
    dot: 'bg-[var(--tone-neutral-text)]',
  },
  accent: {
    bg: 'bg-[var(--tone-accent-bg)]',
    border: 'border-[var(--tone-accent-border)]',
    text: 'text-[var(--tone-accent-text)]',
    muted: 'text-[color:color-mix(in_srgb,var(--tone-accent-text)_72%,var(--tone-neutral-muted))]',
    dot: 'bg-[var(--tone-accent-text)]',
  },
  secondary: {
    bg: 'bg-[var(--tone-secondary-bg)]',
    border: 'border-[var(--tone-secondary-border)]',
    text: 'text-[var(--tone-secondary-text)]',
    muted: 'text-[color:color-mix(in_srgb,var(--tone-secondary-text)_72%,var(--tone-neutral-muted))]',
    dot: 'bg-[var(--tone-secondary-text)]',
  },
  tertiary: {
    bg: 'bg-[var(--tone-tertiary-bg)]',
    border: 'border-[var(--tone-tertiary-border)]',
    text: 'text-[var(--tone-tertiary-text)]',
    muted: 'text-[color:color-mix(in_srgb,var(--tone-tertiary-text)_72%,var(--tone-neutral-muted))]',
    dot: 'bg-[var(--tone-tertiary-text)]',
  },
  success: {
    bg: 'bg-[var(--tone-success-bg)]',
    border: 'border-[var(--tone-success-border)]',
    text: 'text-[var(--tone-success-text)]',
    muted: 'text-[color:color-mix(in_srgb,var(--tone-success-text)_72%,var(--tone-neutral-muted))]',
    dot: 'bg-[var(--tone-success-text)]',
  },
  danger: {
    bg: 'bg-[var(--tone-danger-bg)]',
    border: 'border-[var(--tone-danger-border)]',
    text: 'text-[var(--tone-danger-text)]',
    muted: 'text-[color:color-mix(in_srgb,var(--tone-danger-text)_72%,var(--tone-neutral-muted))]',
    dot: 'bg-[var(--tone-danger-text)]',
  },
} as const;

export const notificationConfig = {
  info: {
    icon: 'Info',
    ...toneConfig.secondary,
  },
  warning: {
    icon: 'AlertTriangle',
    ...toneConfig.accent,
  },
  error: {
    icon: 'AlertCircle',
    ...toneConfig.danger,
  },
} as const;

export const reasoningConfig = {
  react: {
    icon: 'RefreshCw',
    label: 'ReAct',
    ...toneConfig.secondary,
  },
  tot: {
    icon: 'TreePine',
    label: 'Tree-of-Thoughts',
    ...toneConfig.tertiary,
  },
  'plan-execute': {
    icon: 'ClipboardList',
    label: 'Plan-Execute',
    ...toneConfig.accent,
  },
} as const;

export const todoStatusConfig = {
  pending: {
    icon: 'Clock',
    ...toneConfig.neutral,
    spin: false,
  },
  in_progress: {
    icon: 'Loader2',
    ...toneConfig.accent,
    spin: true,
  },
  completed: {
    icon: 'CheckCircle2',
    ...toneConfig.success,
    spin: false,
  },
} as const;

export const taskStatusConfig = {
  pending: {
    icon: 'Clock',
    ...toneConfig.neutral,
    spin: false,
  },
  blocked: {
    icon: 'X',
    ...toneConfig.danger,
    spin: false,
  },
  in_progress: {
    icon: 'Loader2',
    ...toneConfig.accent,
    spin: true,
  },
  completed: {
    icon: 'CheckCircle2',
    ...toneConfig.success,
    spin: false,
  },
  failed: {
    icon: 'AlertCircle',
    ...toneConfig.danger,
    spin: false,
  },
} as const;

export const priorityConfig = {
  low: {
    bg: toneConfig.secondary.dot,
    text: 'text-[var(--tone-secondary-text)]',
  },
  medium: {
    bg: toneConfig.tertiary.dot,
    text: 'text-[var(--tone-tertiary-text)]',
  },
  high: {
    bg: toneConfig.accent.dot,
    text: 'text-[var(--tone-accent-text)]',
  },
  critical: {
    bg: toneConfig.danger.dot,
    text: 'text-[var(--tone-danger-text)]',
  },
} as const;

export const summarizationConfig = {
  starting: { label: 'Starting...', icon: 'Database', ...toneConfig.tertiary, spin: false },
  in_progress: { label: 'Compressing...', icon: 'Loader2', ...toneConfig.tertiary, spin: true },
  complete: { label: 'Complete', icon: 'CheckCircle2', ...toneConfig.success, spin: false },
  failed: { label: 'Failed', icon: 'AlertCircle', ...toneConfig.danger, spin: false },
} as const;

export const toolStageConfig = {
  starting: { label: 'Starting', icon: 'Activity', ...toneConfig.secondary, spin: false },
  in_progress: { label: 'Running', icon: 'Loader2', ...toneConfig.accent, spin: true },
  complete: { label: 'Complete', icon: 'CheckCircle2', ...toneConfig.success, spin: false },
  failed: { label: 'Failed', icon: 'AlertCircle', ...toneConfig.danger, spin: false },
} as const;

export const memoryTypeConfig = {
  lesson: { icon: 'Lightbulb', ...toneConfig.accent },
  fact: { icon: 'FileText', ...toneConfig.secondary },
  pattern: { icon: 'Network', ...toneConfig.tertiary },
} as const;

export const memoryActionConfig = {
  saved: { label: 'saved', color: toneConfig.success.text },
  updated: { label: 'updated', color: toneConfig.secondary.text },
  deleted: { label: 'deleted', color: toneConfig.danger.text },
} as const;

export const delegationConfig = {
  starting: { icon: 'Activity', ...toneConfig.secondary, spin: false },
  in_progress: { icon: 'Loader2', ...toneConfig.accent, spin: true },
  complete: { icon: 'CheckCircle2', ...toneConfig.success, spin: false },
  failed: { icon: 'AlertCircle', ...toneConfig.danger, spin: false },
} as const;
