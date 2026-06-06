import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, type AgentThoughtData } from './types';

/**
 * A sub-agent's live reasoning, forwarded from its delegated run. Collapsible —
 * open by default so you can watch it think; collapse it once you've seen enough.
 */
export const AgentThoughtPart: React.FC<{ data: AgentThoughtData }> = ({ data }) => {
  const [open, setOpen] = useState(true);
  if (!data?.text) return null;

  return (
    <motion.div
      {...animationProps}
      className="overflow-hidden rounded-lg border border-[color:var(--color-line)] bg-[rgba(244,238,228,0.03)]"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        <Brain className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-ink-faint)]" />
        <span className="text-[12px] font-medium text-[color:var(--color-ink-soft)]">Thinking</span>
        <span className="flex-1" />
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-[color:var(--color-ink-faint)] transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <p className="max-h-60 overflow-y-auto whitespace-pre-wrap px-3 pb-2 font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink-faint)]">
              {data.text}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
