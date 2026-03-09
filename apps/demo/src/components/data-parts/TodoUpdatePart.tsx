import React from 'react';
import { motion } from 'framer-motion';
import { Clock, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  todoStatusConfig,
  animationProps,
  dataPartStyles,
  type TodoUpdateData,
} from './types';

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
      className={cn(
        dataPartStyles.chip,
        config.bg,
        config.border
      )}
    >
      <Icon
        className={cn(
          'w-3.5 h-3.5',
          config.text,
          config.spin && 'animate-spin'
        )}
      />
      <span
        className={cn(
          data.status === 'completed'
            ? `${config.muted} line-through`
            : config.text
        )}
      >
        {data.title || data.id}
      </span>
    </motion.div>
  );
};
