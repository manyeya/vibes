import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ModelOption {
  id: string;
  label: string;
  free: boolean;
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
  const ref = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === value);

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

  if (models.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[color:var(--color-ink-soft)] transition-colors hover:border-[color:var(--color-amber)]/60 hover:text-[color:var(--color-ink)]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Cpu className="h-3.5 w-3.5 text-[color:var(--color-amber)]" />
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
              'absolute right-0 z-[60] w-64 overflow-hidden rounded-xl border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] p-1 shadow-2xl shadow-black/40',
              placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
            )}
          >
            {models.map((m) => {
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
                    'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                    active ? 'bg-[rgba(244,238,228,0.06)]' : 'hover:bg-[rgba(244,238,228,0.035)]'
                  )}
                >
                  <Check
                    className={cn(
                      'mt-0.5 h-3.5 w-3.5 shrink-0',
                      active ? 'text-[color:var(--color-amber)]' : 'text-transparent'
                    )}
                  />
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
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
