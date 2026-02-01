// Status color configurations
export const STATUS_COLORS = {
  pending: 'bg-zinc-800/50 text-zinc-400 border-zinc-700',
  in_progress: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  blocked: 'bg-red-500/10 text-red-400 border-red-500/20',
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  failed: 'bg-red-500/10 text-red-400 border-red-500/20',
} as const;

export const PRIORITY_COLORS = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-emerald-500',
} as const;

export const REASONING_MODE = {
  react: {
    label: 'ReAct',
    icon: 'RefreshCw',
    color: 'text-cyan-400',
    gradient: 'from-cyan-500/10 to-cyan-500/5',
    border: 'border-cyan-500/20',
  },
  tot: {
    label: 'Tree-of-Thoughts',
    icon: 'TreePine',
    color: 'text-violet-400',
    gradient: 'from-violet-500/10 to-violet-500/5',
    border: 'border-violet-500/20',
  },
  'plan-execute': {
    label: 'Plan-Execute',
    icon: 'ClipboardList',
    color: 'text-amber-400',
    gradient: 'from-amber-500/10 to-amber-500/5',
    border: 'border-amber-500/20',
  },
} as const;

export const TASK_STATUS_ICONS = {
  pending: 'Clock',
  in_progress: 'Loader2',
  blocked: 'Prohibit',
  completed: 'CheckCircle2',
  failed: 'XCircle',
} as const;

export const MEMORY_TYPE_CONFIG = {
  lesson: { icon: 'Lightbulb', color: 'text-amber-400', bgColor: 'bg-amber-500/10' },
  fact: { icon: 'FileText', color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
  pattern: { icon: 'Network', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10' },
} as const;

export const SUMMARIZATION_STAGE_LABELS = {
  starting: 'Starting...',
  in_progress: 'Compressing...',
  complete: 'Complete',
  failed: 'Failed',
} as const;

export const TOOL_STAGE_LABELS = {
  starting: 'Starting',
  in_progress: 'Running',
  complete: 'Complete',
  failed: 'Failed',
} as const;

export const CAPABILITIES = [
  'Planning',
  'Tree-of-Thoughts',
  'Semantic Memory',
  'Reflexion',
  'Procedural',
  'Swarm',
] as const;

export const Z_INDEX_SCALE = {
  base: 0,
  sidebar: 40,
  backdrop: 50,
  dropdown: 60,
  modal: 70,
  toast: 80,
} as const;

export const ANIMATION_DURATION = {
  fast: 150,
  normal: 200,
  slow: 300,
} as const;
