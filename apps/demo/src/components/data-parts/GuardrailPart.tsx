import React from 'react';
import { motion } from 'framer-motion';
import { ShieldX, ShieldAlert, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, type GuardrailData } from './types';

// blocked = hard stop (red); redacted/exceeded = altered/limited (amber).
const actionConfig = {
  blocked: {
    icon: ShieldX,
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-900/50',
    label: 'Blocked',
  },
  redacted: {
    icon: ShieldCheck,
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-900/50',
    label: 'Redacted',
  },
  exceeded: {
    icon: ShieldAlert,
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-900/50',
    label: 'Budget exceeded',
  },
} as const;

export const GuardrailPart: React.FC<{ data: GuardrailData }> = ({ data }) => {
  const config = actionConfig[data.action] ?? actionConfig.blocked;
  const Icon = config.icon;

  return (
    <motion.div
      {...animationProps}
      className={cn('flex items-start gap-2 px-3 py-2 rounded-lg border text-xs', config.bg, config.border)}
    >
      <Icon className={cn('w-3.5 h-3.5 mt-px shrink-0', config.color)} />
      <span className="min-w-0">
        <span className={cn('font-medium', config.color)}>{config.label}</span>
        {data.guardrail !== 'budget' && (
          <span className={cn('opacity-70', config.color)}> · {data.guardrail}</span>
        )}
        <span className={cn('ml-1.5', config.color)}>{data.message}</span>
      </span>
    </motion.div>
  );
};
