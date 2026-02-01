import React from 'react';
import { motion } from 'framer-motion';
import { Clock, Loader2, CheckCircle2, X, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { taskStatusConfig, priorityConfig, animationProps, type TaskUpdateData } from './types';

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
        'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs',
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
            'ml-auto text-[9px] uppercase px-1.5 py-0.5 rounded bg-zinc-700/50',
            priorityConfig[data.priority].text
          )}
        >
          {data.priority}
        </span>
      )}
      {data.error && data.status === 'failed' && (
        <span className="ml-2 text-red-400/70 text-[10px] truncate max-w-[150px]">
          {data.error}
        </span>
      )}
    </motion.div>
  );
};
