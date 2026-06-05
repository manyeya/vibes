import React from 'react';
import { motion } from 'framer-motion';
import { Power, PowerOff, Layers } from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, type SkillData } from './types';

export const SkillPart: React.FC<{ data: SkillData }> = ({ data }) => {
  if (data.action === 'list') {
    return (
      <motion.div
        {...animationProps}
        className="w-full rounded-lg border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] px-3 py-2"
      >
        <div className="flex items-center gap-2 text-[color:var(--color-ink-faint)]">
          <Layers className="h-3.5 w-3.5" />
          <span className="font-mono text-[10px] uppercase tracking-wide">Skills · {data.skills?.length ?? 0}</span>
        </div>
        {data.skills && data.skills.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {data.skills.map((s) => (
              <span key={s} className="rounded-md bg-[rgba(244,238,228,0.05)] px-1.5 py-0.5 text-[11px] text-[color:var(--color-ink-soft)]">
                {s}
              </span>
            ))}
          </div>
        )}
      </motion.div>
    );
  }

  const activated = data.action === 'activate';
  const Icon = activated ? Power : PowerOff;
  return (
    <motion.div
      {...animationProps}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs',
        activated
          ? 'border-[color:var(--color-line-strong)] bg-[rgba(240,184,108,0.08)]'
          : 'border-[color:var(--color-line)] bg-[color:var(--color-surface)]'
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', activated ? 'text-[color:var(--color-amber)]' : 'text-[color:var(--color-ink-faint)]')} />
      <span className="text-[color:var(--color-ink-soft)]">{activated ? 'Activated' : 'Deactivated'}</span>
      <span className="font-medium text-[color:var(--color-ink)]">{data.name}</span>
    </motion.div>
  );
};
