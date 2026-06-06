import React from 'react';
import { Activity, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { delegationConfig, animationProps, type DelegationData } from './types';

const iconMap = { Activity, Loader2, CheckCircle2, AlertCircle };

// Read as an action ("Delegated → planner"), not a noun, so the card clearly
// reads as the MAIN agent handing work off — distinct from its own prose.
const statusVerb: Record<DelegationData['status'], string> = {
  starting: 'Delegating',
  in_progress: 'Delegating',
  complete: 'Delegated',
  failed: 'Delegation failed',
};

/**
 * A compact delegation handoff. Leads with WHAT was delegated (the task is the
 * ground truth — the agent's self-chosen name can be misleading), confirms
 * completion with a clamped one-glance summary, and links the artifact. It no
 * longer reprints the sub-agent's full answer — that lives under the agent's
 * tab / in the artifact, so the chat stops triple-telling the same thing.
 */
export const DelegationPart: React.FC<{ data: DelegationData }> = ({ data }) => {
  const config = delegationConfig[data.status];
  const Icon = iconMap[config.icon as keyof typeof iconMap];
  const task = (data.task ?? '').trim();
  const summary = (data.summary ?? '').trim();
  const showSummary = data.status === 'complete' && !!summary && summary !== task;

  return (
    <motion.div
      {...animationProps}
      className={cn('rounded-lg border px-3 py-2 text-xs', config.bg, config.border)}
    >
      <div className={cn('flex items-center gap-1.5', config.text)}>
        <Icon className={cn('h-3.5 w-3.5 shrink-0', config.spin && 'animate-spin')} />
        <span className="font-medium">{statusVerb[data.status]}</span>
        <span className="opacity-50">→</span>
        <span className="font-medium opacity-90">{data.agentName}</span>
        {data.cached && (
          <span
            className="ml-auto rounded bg-black/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide opacity-80 dark:bg-white/10"
            title="Reused a cached result"
          >
            cached
          </span>
        )}
      </div>

      {task && (
        <div className="mt-1 line-clamp-2 break-words text-[color:var(--color-ink-soft)]">{task}</div>
      )}
      {showSummary && (
        <div className="mt-1 line-clamp-2 break-words text-[color:var(--color-ink-faint)]">{summary}</div>
      )}
      {data.status === 'failed' && data.error && (
        <div className="mt-1 break-words text-[color:var(--color-ember)]">{data.error}</div>
      )}
      {data.artifactPath && (
        <div className="mt-1 break-all text-[10px] text-[color:var(--color-ink-faint)]">↳ {data.artifactPath}</div>
      )}
    </motion.div>
  );
};
