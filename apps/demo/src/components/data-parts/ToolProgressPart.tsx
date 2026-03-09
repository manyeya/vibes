import React from 'react';
import { motion } from 'framer-motion';
import { Activity, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  toolStageConfig,
  animationProps,
  dataPartStyles,
  type ToolProgressData,
} from './types';

const iconMap = {
  Activity,
  Loader2,
  CheckCircle2,
  AlertCircle,
};

function formatElapsed(elapsedMs?: number): string | null {
  if (elapsedMs === undefined) {
    return null;
  }

  if (elapsedMs < 1000) {
    return `${elapsedMs}ms`;
  }

  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

export const ToolProgressPart: React.FC<{ data: ToolProgressData }> = ({ data }) => {
  const config = data.stage ? toolStageConfig[data.stage] : toolStageConfig.in_progress;
  const Icon = iconMap[config.icon as keyof typeof iconMap];
  const label = data.message ?? `${data.toolName}${data.stage ? `: ${config.label}` : ''}`;
  const metadata = [
    data.plugin,
    data.agentName,
    data.attempt !== undefined ? `attempt ${data.attempt}` : null,
    formatElapsed(data.elapsedMs),
  ].filter(Boolean).join(' · ');

  return (
    <motion.div
      {...animationProps}
      className={cn(
        dataPartStyles.stack,
        config.bg,
        config.border,
        config.text
      )}
    >
      <div className="inline-flex items-center gap-2">
        <Icon className={cn('w-3 h-3', config.spin && 'animate-spin')} />
        <span>
          {label}
          {data.progress !== undefined && (
            <span className={cn('ml-1', config.muted)}>({data.progress}%)</span>
          )}
        </span>
      </div>
      {metadata && (
        <span className={cn(dataPartStyles.meta, config.muted)}>{metadata}</span>
      )}
    </motion.div>
  );
};
