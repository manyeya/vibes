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

  return (
    <motion.div
      {...animationProps}
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs',
        config.bg,
        config.border
      )}
    >
      <Icon className={cn('w-3.5 h-3.5', config.text, config.spin && 'animate-spin')} />
      <span className={config.text}>
        <span className="font-medium">{data.agentName}</span>
        {' '}delegated: {data.task}
      </span>
    </motion.div>
  );
};
