import React from 'react';
import { motion } from 'framer-motion';
import { Lightbulb, FileText, Network } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  memoryTypeConfig,
  memoryActionConfig,
  animationProps,
  dataPartStyles,
  type MemoryUpdateData,
} from './types';

const iconMap = {
  Lightbulb,
  FileText,
  Network,
};

export const MemoryUpdatePart: React.FC<{ data: MemoryUpdateData }> = ({ data }) => {
  const typeConfig = memoryTypeConfig[data.type];
  const actionConfig = memoryActionConfig[data.action];
  const Icon = iconMap[typeConfig.icon as keyof typeof iconMap];

  return (
    <motion.div
      {...animationProps}
      className={cn(
        dataPartStyles.chip,
        typeConfig.bg,
        typeConfig.border
      )}
    >
      <Icon className={cn('w-3 h-3', typeConfig.text)} />
      <span className={typeConfig.text}>
        {data.type.charAt(0).toUpperCase() + data.type.slice(1)}{' '}
        <span className={actionConfig.color}>{actionConfig.label}</span>
        {data.count !== undefined && data.count > 1 && (
          <span className="ml-1">({data.count})</span>
        )}
      </span>
    </motion.div>
  );
};
