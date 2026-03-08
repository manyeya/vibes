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
      className="inline-flex flex-col items-start gap-1 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-md text-xs text-blue-700 dark:text-blue-400"
    >
      <div className="inline-flex items-center gap-2">
        <Icon className={cn('w-3 h-3', config.spin && 'animate-spin')} />
        <span>
          {label}
          {data.progress !== undefined && (
            <span className="ml-1 text-blue-600 dark:text-blue-300">({data.progress}%)</span>
          )}
        </span>
      </div>
      {metadata && (
        <span className="text-[11px] text-blue-600 dark:text-blue-300">{metadata}</span>
      )}
    </motion.div>
  );
};
