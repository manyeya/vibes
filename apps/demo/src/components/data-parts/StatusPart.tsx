import React from 'react';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, type StatusData } from './types';

export const StatusPart: React.FC<{ data: StatusData }> = ({ data }) => {
  const showProgress = data.step !== undefined && data.totalSteps !== undefined;

  return (
    <motion.div
      {...animationProps}
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 rounded-lg text-xs text-zinc-400"
    >
      <Clock className="w-3 h-3" />
      <span>{data.message}</span>
      {showProgress && (
        <span className="text-zinc-500">
          ({data.step}/{data.totalSteps})
        </span>
      )}
    </motion.div>
  );
};
