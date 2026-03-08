import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, type ErrorData } from './types';

export const ErrorPart: React.FC<{ data: ErrorData }> = ({ data }) => {
  const metadata = [
    data.toolName ? `tool ${data.toolName}` : null,
    data.plugin,
    data.agentName,
    data.attempt !== undefined ? `attempt ${data.attempt}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <motion.div
      {...animationProps}
      className={cn(
        'flex items-start gap-2 p-3 rounded-md border',
        data.recoverable
          ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50'
          : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/50'
      )}
    >
      <AlertCircle
        className={cn(
          'w-4 h-4 shrink-0 mt-0.5',
          data.recoverable ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
        )}
      />
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'text-sm',
            data.recoverable ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400'
          )}
        >
          {data.error}
        </p>
        {metadata && (
          <p className="text-xs text-zinc-600 dark:text-zinc-500 mt-1">{metadata}</p>
        )}
        {data.context && (
          <p className="text-xs text-zinc-500 dark:text-zinc-600 mt-1 truncate">{data.context}</p>
        )}
      </div>
    </motion.div>
  );
};
