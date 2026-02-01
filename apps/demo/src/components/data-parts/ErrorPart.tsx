import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, type ErrorData } from './types';

export const ErrorPart: React.FC<{ data: ErrorData }> = ({ data }) => {
  return (
    <motion.div
      {...animationProps}
      className={cn(
        'flex items-start gap-2 p-3 rounded-lg border',
        data.recoverable
          ? 'bg-amber-500/10 border-amber-500/20'
          : 'bg-red-500/10 border-red-500/20'
      )}
    >
      <AlertCircle
        className={cn(
          'w-4 h-4 shrink-0 mt-0.5',
          data.recoverable ? 'text-amber-400' : 'text-red-400'
        )}
      />
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'text-sm',
            data.recoverable ? 'text-amber-400' : 'text-red-400'
          )}
        >
          {data.error}
        </p>
        {data.toolName && (
          <p className="text-xs text-zinc-500 mt-1">Tool: {data.toolName}</p>
        )}
        {data.context && (
          <p className="text-xs text-zinc-600 mt-1 truncate">{data.context}</p>
        )}
      </div>
    </motion.div>
  );
};
