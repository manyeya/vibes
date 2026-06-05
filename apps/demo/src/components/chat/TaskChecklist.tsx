import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ListChecks, ChevronDown, Circle, Check, Loader2, Ban, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ChecklistTask {
  id: string;
  title?: string;
  status: 'pending' | 'blocked' | 'in_progress' | 'completed' | 'failed';
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

const statusMeta: Record<ChecklistTask['status'], { Icon: React.ElementType; cls: string; spin?: boolean }> = {
  pending: { Icon: Circle, cls: 'text-[color:var(--color-ink-faint)]' },
  in_progress: { Icon: Loader2, cls: 'text-[color:var(--color-amber)]', spin: true },
  completed: { Icon: Check, cls: 'text-[color:var(--color-moss)]' },
  blocked: { Icon: Ban, cls: 'text-[color:var(--color-amber)]' },
  failed: { Icon: X, cls: 'text-[color:var(--color-ember)]' },
};

export const TaskChecklist = ({ tasks }: { tasks: ChecklistTask[] }) => {
  const [open, setOpen] = useState(true);
  if (tasks.length === 0) return null;

  const done = tasks.filter((t) => t.status === 'completed').length;
  const active = tasks.find((t) => t.status === 'in_progress');
  const pct = tasks.length ? (done / tasks.length) * 100 : 0;

  return (
    <div className="mx-auto mb-2 max-w-3xl overflow-hidden rounded-xl border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-amber)]" />
        <span className="text-[12px] font-medium text-[color:var(--color-ink)]">Tasks</span>
        <span className="font-mono text-[11px] text-[color:var(--color-ink-faint)]">{done}/{tasks.length}</span>
        {!open && active?.title && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-[color:var(--color-ink-soft)]">· {active.title}</span>
        )}
        <span className="flex-1" />
        <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-[rgba(244,238,228,0.08)]">
          <span
            className="block h-full rounded-full bg-[color:var(--color-moss)] transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 text-[color:var(--color-ink-faint)] transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="max-h-44 overflow-y-auto border-t border-[color:var(--color-line)] px-1.5 py-1.5"
          >
            {tasks.map((t) => {
              const m = statusMeta[t.status];
              const Icon = m.Icon;
              const highPriority = t.priority === 'high' || t.priority === 'critical';
              return (
                <li key={t.id} className="flex items-center gap-2.5 rounded-md px-1.5 py-1">
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', m.cls, m.spin && 'animate-spin')} />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-[12px]',
                      t.status === 'completed'
                        ? 'text-[color:var(--color-ink-faint)] line-through'
                        : t.status === 'in_progress'
                          ? 'text-[color:var(--color-ink)]'
                          : 'text-[color:var(--color-ink-soft)]'
                    )}
                  >
                    {t.title ?? t.id}
                  </span>
                  {highPriority && t.status !== 'completed' && (
                    <span className="shrink-0 rounded bg-[rgba(239,108,79,0.12)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[color:var(--color-ember)]">
                      {t.priority}
                    </span>
                  )}
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
};
