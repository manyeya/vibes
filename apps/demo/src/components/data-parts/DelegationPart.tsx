import React from 'react';
import { motion } from 'framer-motion';
import { Activity, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { delegationConfig, animationProps, type DelegationData } from './types';

const iconMap = {
  Activity,
  Loader2,
  CheckCircle2,
  AlertCircle,
};

export const DelegationPart: React.FC<{ data: DelegationData }> = ({ data }) => {
  const config = delegationConfig[data.status];
  const Icon = iconMap[config.icon as keyof typeof iconMap];
  const label = data.status === 'complete'
    ? data.summary ?? 'Completed'
    : data.status === 'failed'
      ? data.error ?? 'Delegation failed'
      : data.task;

  return (
    <motion.div
      {...animationProps}
      className={cn(
        'flex items-start gap-2 px-3 py-2 rounded-lg border text-xs',
        config.bg,
        config.border
      )}
    >
      <Icon className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', config.text, config.spin && 'animate-spin')} />
      <div className={cn('min-w-0 space-y-1', config.text)}>
        <div>
          <span className="font-medium">{data.agentName}</span>
          {' '}
          <span className="uppercase tracking-wide opacity-75">{data.status.replace('_', ' ')}</span>
        </div>
        <div className="break-words">{label}</div>
        {data.artifactPath && (
          <div className="opacity-75 break-all">{data.artifactPath}</div>
        )}
      </div>
    </motion.div>
  );
};
