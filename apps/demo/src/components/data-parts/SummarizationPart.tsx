import React from 'react';
import { motion } from 'framer-motion';
import { Database, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  summarizationConfig,
  animationProps,
  dataPartStyles,
  type SummarizationData,
} from './types';

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
      className={cn(
        dataPartStyles.chip,
        config.bg,
        config.border,
        config.text
      )}
    >
      <Icon
        className={cn('w-3 h-3', config.spin && 'animate-spin')}
      />
      <span>
        Context compressed: {config.label}
        {data.saved !== undefined && data.saved > 0 && (
          <span className={cn('ml-1', config.muted)}>
            (saved {data.saved.toLocaleString()} tokens)
          </span>
        )}
      </span>
      {data.error && (
        <span className="ml-2 text-[10px] text-[var(--tone-danger-text)]">{data.error}</span>
      )}
    </motion.div>
  );
};
