import React from 'react';
import { motion } from 'framer-motion';
import { Clock, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { todoStatusConfig, animationProps, type TodoUpdateData } from './types';

const iconMap = {
  Clock,
  Loader2,
  CheckCircle2,
};

export const TodoUpdatePart: React.FC<{ data: TodoUpdateData }> = ({ data }) => {
  const config = todoStatusConfig[data.status];
  const Icon = iconMap[config.icon as keyof typeof iconMap];

  return (
    <motion.div
      {...animationProps}
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700 text-xs"
    >
      <Icon
        className={cn(
          'w-3.5 h-3.5',
          config.color,
          config.spin && 'animate-spin'
        )}
      />
      <span
        className={
          data.status === 'completed'
            ? 'text-zinc-500 line-through'
            : 'text-zinc-300'
        }
      >
        {data.title || data.id}
      </span>
    </motion.div>
  );
};
