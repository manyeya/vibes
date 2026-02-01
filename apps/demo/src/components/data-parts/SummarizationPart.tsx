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
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-lg text-xs text-purple-400"
    >
      <Icon
        className={cn('w-3 h-3', config.spin && 'animate-spin')}
      />
      <span>
        Context compressed: {config.label}
        {data.saved !== undefined && data.saved > 0 && (
          <span className="ml-1 text-purple-300">
            (saved {data.saved.toLocaleString()} tokens)
          </span>
        )}
      </span>
      {data.error && (
        <span className="ml-2 text-red-400 text-[10px]">{data.error}</span>
      )}
    </motion.div>
  );
};
