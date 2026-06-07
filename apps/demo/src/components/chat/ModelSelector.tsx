import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ProviderLogo } from './ProviderLogo';

export interface ModelOption {
  id: string;
  label: string;
  free: boolean;
  /** Provider/family used to group options in the dropdown. */
  group?: string;
  note?: string;
  priceIn?: number;
  priceOut?: number;
}

interface ModelSelectorProps {
  models: ModelOption[];
  value: string;
  onChange: (id: string) => void;
  /** Which way the dropdown opens. Use 'top' inside the composer. */
  placement?: 'top' | 'bottom';
}

export const ModelSelector = ({ models, value, onChange, placement = 'bottom' }: ModelSelectorProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === value);

  // Filter on label/id/group, then bucket into groups (preserving the order the
  // backend already sorted them in). "Other" catches anything ungrouped.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? models.filter(
          (m) =>
            m.label.toLowerCase().includes(q) ||
            m.id.toLowerCase().includes(q) ||
            (m.group ?? '').toLowerCase().includes(q),
        )
      : models;
    const order: string[] = [];
    const byGroup = new Map<string, ModelOption[]>();
    for (const m of matched) {
      const g = m.group ?? 'Other';
      if (!byGroup.has(g)) {
        byGroup.set(g, []);
        order.push(g);
      }
      byGroup.get(g)!.push(m);
    }
    return order.map((g) => [g, byGroup.get(g)!] as const);
  }, [models, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset the filter whenever the menu closes so it reopens clean.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  if (models.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[color:var(--color-ink-soft)] transition-colors hover:border-[color:var(--color-amber)]/60 hover:text-[color:var(--color-ink)]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {current ? (
          <ProviderLogo modelId={current.id} label={current.group} size={16} />
        ) : (
          <Cpu className="h-3.5 w-3.5 text-[color:var(--color-amber)]" />
        )}
        <span className="max-w-[150px] truncate">{current?.label ?? 'Select model'}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-200', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: placement === 'top' ? 6 : -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: placement === 'top' ? 6 : -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            role="listbox"
            className={cn(
              'absolute right-0 z-[60] flex max-h-[60vh] w-72 flex-col overflow-hidden rounded-xl border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] shadow-2xl shadow-black/40',
              placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
            )}
          >
            {/* Filter — the free catalog can be dozens of models. */}
            <div className="shrink-0 border-b border-[color:var(--color-line)] p-1.5">
              <div className="flex items-center gap-2 rounded-lg bg-[rgba(244,238,228,0.04)] px-2 py-1.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-ink-faint)]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models"
                  className="w-full bg-transparent text-[12.5px] text-[color:var(--color-ink)] outline-none placeholder:text-[color:var(--color-ink-faint)]"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {groups.length === 0 ? (
                <div className="px-2.5 py-6 text-center text-[12px] text-[color:var(--color-ink-faint)]">
                  No models match.
                </div>
              ) : (
                groups.map(([group, items]) => (
                  <div key={group} className="mb-1 last:mb-0">
                    <div className="flex items-center gap-2 px-2.5 pb-1 pt-1.5">
                      <ProviderLogo modelId={items[0]?.id} label={group} size={13} />
                      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
                        {group}
                      </span>
                      <span className="h-px flex-1 bg-[color:var(--color-line)]" />
                      <span className="font-mono text-[9px] text-[color:var(--color-ink-faint)] opacity-70">
                        {items.length}
                      </span>
                    </div>
                    {items.map((m) => {
                      const active = m.id === value;
                      return (
                        <button
                          key={m.id}
                          role="option"
                          aria-selected={active}
                          onClick={() => {
                            onChange(m.id);
                            setOpen(false);
                          }}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                            active ? 'bg-[rgba(244,238,228,0.06)]' : 'hover:bg-[rgba(244,238,228,0.035)]'
                          )}
                        >
                          <ProviderLogo modelId={m.id} label={m.group} size={18} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[13px] text-[color:var(--color-ink)]">{m.label}</span>
                              {!m.free && (
                                <span className="shrink-0 rounded-md bg-[rgba(240,184,108,0.15)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[color:var(--color-amber)]">
                                  paid
                                </span>
                              )}
                            </span>
                            {m.note && (
                              <span className="mt-0.5 block truncate text-[11px] text-[color:var(--color-ink-faint)]">
                                {m.note}
                              </span>
                            )}
                          </span>
                          <Check
                            className={cn(
                              'h-3.5 w-3.5 shrink-0',
                              active ? 'text-[color:var(--color-amber)]' : 'text-transparent'
                            )}
                          />
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
