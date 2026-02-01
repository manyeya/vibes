import React from 'react';
import { motion } from 'framer-motion';
import { Activity, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toolStageConfig, animationProps, type ToolProgressData } from './types';

const iconMap = {
  Activity,
  Loader2,
  CheckCircle2,
  AlertCircle,
};

export const ToolProgressPart: React.FC<{ data: ToolProgressData }> = ({ data }) => {
  const config = data.stage ? toolStageConfig[data.stage] : toolStageConfig.in_progress;
  const Icon = iconMap[config.icon as keyof typeof iconMap];

  return (
    <motion.div
      {...animationProps}
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-400"
    >
      <Icon className={cn('w-3 h-3', config.spin && 'animate-spin')} />
      <span>
        {data.toolName}
        {data.stage && `: ${config.label}`}
        {data.progress !== undefined && (
          <span className="ml-1 text-blue-300">({data.progress}%)</span>
        )}
      </span>
    </motion.div>
  );
};
