import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Gauge } from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, type ReasoningSelectionData } from './types';

export const ReasoningSelectionPart: React.FC<{ data: ReasoningSelectionData }> = ({ data }) => {
  if (!data?.selectedId) return null;

  return (
    <motion.div
      {...animationProps}
      className={cn(
        'w-full rounded-xl border p-3',
        'border-emerald-300 dark:border-emerald-800',
        'bg-emerald-50/70 dark:bg-emerald-950/30'
      )}
    >
      <div className="flex items-start gap-2.5">
        <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            Selected approach
            {typeof data.score === 'number' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-[10px]">
                <Gauge className="w-3 h-3" /> {data.score}/10
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-100">{data.thought}</p>
          {data.expectedOutcome && (
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">→ {data.expectedOutcome}</p>
          )}
          {data.reasoning && (
            <p className="mt-1 text-xs italic text-zinc-500 dark:text-zinc-400">{data.reasoning}</p>
          )}
          {data.discardedIds.length > 0 && (
            <p className="mt-1.5 text-[10px] text-zinc-400">
              {data.discardedIds.length} other branch{data.discardedIds.length === 1 ? '' : 'es'} discarded
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
};
