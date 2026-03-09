import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, dataPartStyles, toneConfig, type ErrorData } from './types';

export const ErrorPart: React.FC<{ data: ErrorData }> = ({ data }) => {
  const tone = data.recoverable ? toneConfig.accent : toneConfig.danger;
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
        dataPartStyles.panel,
        'flex items-start gap-2',
        tone.bg,
        tone.border
      )}
    >
      <AlertCircle
        className={cn(
          'w-4 h-4 shrink-0 mt-0.5',
          tone.text
        )}
      />
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm', tone.text)}>
          {data.error}
        </p>
        {metadata && (
          <p className={cn('mt-1 text-xs', tone.muted)}>{metadata}</p>
        )}
        {data.context && (
          <p className="mt-1 truncate text-xs text-[var(--tone-neutral-muted)]">{data.context}</p>
        )}
      </div>
    </motion.div>
  );
};
