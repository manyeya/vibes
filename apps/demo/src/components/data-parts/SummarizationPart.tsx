import React from 'react';
import { motion } from 'framer-motion';
import { Database, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { summarizationConfig, animationProps, type SummarizationData } from './types';

const iconMap = {
  Database,
  Loader2,
  CheckCircle2,
  AlertCircle,
};

export const SummarizationPart: React.FC<{ data: SummarizationData }> = ({ data }) => {
  const config = summarizationConfig[data.stage];
  const Icon = iconMap[config.icon as keyof typeof iconMap];

  return (
    <motion.div
      {...animationProps}
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900/50 rounded-md text-xs text-purple-700 dark:text-purple-400"
    >
      <Icon
        className={cn('w-3 h-3', config.spin && 'animate-spin')}
      />
      <span>
        Context compressed: {config.label}
        {data.saved !== undefined && data.saved > 0 && (
          <span className="ml-1 text-purple-600 dark:text-purple-300">
            (saved {data.saved.toLocaleString()} tokens)
          </span>
        )}
      </span>
      {data.error && (
        <span className="ml-2 text-red-600 dark:text-red-400 text-[10px]">{data.error}</span>
      )}
    </motion.div>
  );
};
