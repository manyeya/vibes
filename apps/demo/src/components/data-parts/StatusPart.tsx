import React from 'react';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { animationProps, type StatusData } from './types';

export const StatusPart: React.FC<{ data: StatusData }> = ({ data }) => {
  const showProgress = data.step !== undefined && data.totalSteps !== undefined;
  const metadata = [data.plugin, data.agentName, data.phase].filter(Boolean).join(' · ');

  return (
    <motion.div
      {...animationProps}
      className="inline-flex flex-col items-start gap-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800/50 rounded-md text-xs text-zinc-600 dark:text-zinc-400"
    >
      <div className="inline-flex items-center gap-2">
        <Clock className="w-3 h-3" />
        <span>{data.message}</span>
        {showProgress && (
          <span className="text-zinc-500 dark:text-zinc-500">
            ({data.step}/{data.totalSteps})
          </span>
        )}
      </div>
      {metadata && (
        <span className="text-[11px] text-zinc-500 dark:text-zinc-500">{metadata}</span>
      )}
    </motion.div>
  );
};
