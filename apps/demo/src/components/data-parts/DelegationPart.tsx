import React, { useState } from 'react';
import { Activity, Loader2, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react';
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
 * A delegation handoff, collapsed to a single line in the main thread: status →
 * agent + the task (truncated). A turn that fans out to many sub-agents would
 * otherwise stack a tall result card per agent above everything that follows —
 * so the body (the sub-agent's summary, error and artifact path) is tucked
 * behind a click. The live sub-agent's own work streams under its tab; the
 * built output lands in the canvas.
 */
export const DelegationPart: React.FC<{ data: DelegationData }> = ({ data }) => {
  const [open, setOpen] = useState(false);
  const config = delegationConfig[data.status];
  const Icon = iconMap[config.icon as keyof typeof iconMap];
  const task = (data.task ?? '').trim();
  const summary = (data.summary ?? '').trim();
  const showSummary = data.status === 'complete' && !!summary && summary !== task;
  const hasDetail = showSummary || (data.status === 'failed' && !!data.error) || !!data.artifactPath;

  return (
    <motion.div
      {...animationProps}
      className={cn('rounded-lg border text-xs', config.bg, config.border)}
    >
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={cn('flex w-full items-center gap-1.5 px-3 py-2 text-left', config.text, hasDetail && 'cursor-pointer')}
      >
        <Icon className={cn('h-3.5 w-3.5 shrink-0', config.spin && 'animate-spin')} />
        <span className="shrink-0 font-medium">{statusVerb[data.status]}</span>
        <span className="shrink-0 opacity-50">→</span>
        <span className="shrink-0 font-medium opacity-90">{data.agentName}</span>
        {task && (
          <span className="min-w-0 flex-1 truncate font-normal text-[color:var(--color-ink-soft)]">{task}</span>
        )}
        {data.cached && (
          <span
            className="shrink-0 rounded bg-black/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide opacity-80 dark:bg-white/10"
            title="Reused a cached result"
          >
            cached
          </span>
        )}
        {hasDetail && (
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 opacity-50 transition-transform', open && 'rotate-180')} />
        )}
      </button>

      {open && hasDetail && (
        <div className="space-y-1 border-t border-[color:var(--color-line)] px-3 py-2">
          {task && <div className="break-words text-[color:var(--color-ink-soft)]">{task}</div>}
          {showSummary && <div className="break-words text-[color:var(--color-ink-faint)]">{summary}</div>}
          {data.status === 'failed' && data.error && (
            <div className="break-words text-[color:var(--color-ember)]">{data.error}</div>
          )}
          {data.artifactPath && (
            <div className="break-all text-[10px] text-[color:var(--color-ink-faint)]">↳ {data.artifactPath}</div>
          )}
        </div>
      )}
    </motion.div>
  );
};
