import React from 'react';
import { motion } from 'framer-motion';
import { Terminal, Check, X, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, type CommandData } from './types';

export const CommandPart: React.FC<{ data: CommandData }> = ({ data }) => {
  const running = data.status === 'running';
  const ok = data.exitCode === 0;
  const out = (data.stdout || '').trim();
  const err = (data.stderr || '').trim();

  return (
    <motion.div
      {...animationProps}
      className="w-full overflow-hidden rounded-xl border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)]"
    >
      <div className="flex items-center gap-2 border-b border-[color:var(--color-line)] px-3 py-2">
        <Terminal className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-ink-faint)]" />
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-[color:var(--color-ink)]">{data.command}</code>
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[color:var(--color-amber)]" />
        ) : (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px]',
              ok
                ? 'bg-[rgba(158,193,154,0.15)] text-[color:var(--color-moss)]'
                : 'bg-[rgba(239,108,79,0.15)] text-[color:var(--color-ember)]'
            )}
          >
            {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} exit {data.exitCode}
          </span>
        )}
      </div>
      {(out || err) && (
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-[color:var(--color-ink-soft)]">
          {out}
          {err && (
            <span className="text-[color:var(--color-ember)]">
              {out ? '\n' : ''}
              {err}
            </span>
          )}
        </pre>
      )}
    </motion.div>
  );
};
