import React from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, TreePine, ClipboardList } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  reasoningConfig,
  animationProps,
  dataPartStyles,
  type ReasoningModeData,
} from './types';

const iconMap = {
  RefreshCw,
  TreePine,
  ClipboardList,
};

export const ReasoningModePart: React.FC<{ data: ReasoningModeData }> = ({ data }) => {
  const config = reasoningConfig[data.mode];
  const Icon = iconMap[config.icon as keyof typeof iconMap];

  return (
    <motion.div
      {...animationProps}
      className={cn(
        dataPartStyles.chip,
        config.bg,
        config.border
      )}
    >
      <Icon className={cn('w-3 h-3', config.text)} />
      <span className={config.text}>{config.label}</span>
    </motion.div>
  );
};
