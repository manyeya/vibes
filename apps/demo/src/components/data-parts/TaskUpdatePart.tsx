import React from 'react';
import { motion } from 'framer-motion';
import { Clock, Loader2, CheckCircle2, X, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  taskStatusConfig,
  priorityConfig,
  animationProps,
  dataPartStyles,
  type TaskUpdateData,
} from './types';

const iconMap = {
  Clock,
  Loader2,
  CheckCircle2,
  X,
  AlertCircle,
};

export const TaskUpdatePart: React.FC<{ data: TaskUpdateData }> = ({ data }) => {
  const statusConfig = taskStatusConfig[data.status];
  const StatusIcon = iconMap[statusConfig.icon as keyof typeof iconMap];

  return (
    <motion.div
      {...animationProps}
      className={cn(
        dataPartStyles.chip,
        statusConfig.bg,
        statusConfig.border
      )}
    >
      <StatusIcon
        className={cn(
          'w-3.5 h-3.5',
          statusConfig.text,
          statusConfig.spin && 'animate-spin'
        )}
      />
      <span className={cn('font-medium', statusConfig.text)}>
        {data.title || data.id}
      </span>
      {data.priority && (
        <span
          className={cn(
            'ml-auto rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.18em]',
            statusConfig.border,
            statusConfig.bg,
            priorityConfig[data.priority].text
          )}
        >
          {data.priority}
        </span>
      )}
      {data.error && data.status === 'failed' && (
        <span className="ml-2 max-w-[150px] truncate text-[10px] text-[var(--tone-danger-text)]/80">
          {data.error}
        </span>
      )}
    </motion.div>
  );
};
