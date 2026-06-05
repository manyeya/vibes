import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TreePine, Check, X, Circle, Gauge } from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, type ReasoningThoughtsData } from './types';

type Thought = ReasoningThoughtsData['thoughts'][number];

const statusStyle: Record<Thought['status'], { ring: string; badge: string; label: string }> = {
  proposed: {
    ring: 'border-zinc-200 dark:border-zinc-800',
    badge: 'text-zinc-500 bg-zinc-100 dark:bg-zinc-800/60',
    label: 'proposed',
  },
  evaluated: {
    ring: 'border-blue-200 dark:border-blue-900/50',
    badge: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40',
    label: 'scored',
  },
  selected: {
    ring: 'border-emerald-300 dark:border-emerald-800 ring-1 ring-emerald-300/60 dark:ring-emerald-800/60',
    badge: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40',
    label: 'selected',
  },
  discarded: {
    ring: 'border-zinc-200/60 dark:border-zinc-800/60 opacity-55',
    badge: 'text-zinc-400 bg-zinc-100 dark:bg-zinc-800/40',
    label: 'discarded',
  },
};

const effortColor: Record<Thought['effort'], string> = {
  low: 'text-emerald-600 dark:text-emerald-400',
  medium: 'text-amber-600 dark:text-amber-400',
  high: 'text-rose-600 dark:text-rose-400',
};

const StatusIcon: React.FC<{ status: Thought['status'] }> = ({ status }) => {
  if (status === 'selected') return <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />;
  if (status === 'discarded') return <X className="w-3.5 h-3.5 text-zinc-400" />;
  return <Circle className="w-3.5 h-3.5 text-zinc-400" />;
};

export const ReasoningThoughtsPart: React.FC<{ data: ReasoningThoughtsData }> = ({ data }) => {
  const thoughts = data?.thoughts ?? [];
  if (thoughts.length === 0) return null;

  return (
    <motion.div
      {...animationProps}
      className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/40 p-3"
    >
      <div className="flex items-center gap-2 mb-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
        <TreePine className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
        Tree of Thoughts
        <span className="text-zinc-400 font-normal">· {thoughts.length} branches</span>
      </div>

      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {thoughts.map((t) => {
            const s = statusStyle[t.status];
            return (
              <motion.div
                key={t.id}
                {...animationProps}
                layout
                className={cn('rounded-lg border p-2.5', s.ring)}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">
                    <StatusIcon status={t.status} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm text-zinc-800 dark:text-zinc-100',
                        t.status === 'discarded' && 'line-through'
                      )}
                    >
                      {t.thought}
                    </p>
                    {t.expectedOutcome && (
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        → {t.expectedOutcome}
                      </p>
                    )}
                    {t.reasoning && (
                      <p className="mt-1 text-xs italic text-zinc-400 dark:text-zinc-500">
                        {t.reasoning}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className={cn('px-1.5 py-0.5 rounded-md font-medium', s.badge)}>
                        {s.label}
                      </span>
                      {typeof t.score === 'number' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 font-medium">
                          <Gauge className="w-3 h-3" /> {t.score}/10
                        </span>
                      )}
                      <span className="px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800/60 text-zinc-500">
                        conf {Math.round((t.confidence ?? 0) * 100)}%
                      </span>
                      <span className={cn('px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800/60 font-medium', effortColor[t.effort])}>
                        {t.effort} effort
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
