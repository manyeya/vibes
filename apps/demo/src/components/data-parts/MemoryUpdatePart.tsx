import React from 'react';
import { motion } from 'framer-motion';
import { Lightbulb, FileText, Network } from 'lucide-react';
import { cn } from '../../lib/utils';
import { memoryTypeConfig, memoryActionConfig, animationProps, type MemoryUpdateData } from './types';

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
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs"
      style={{
        backgroundColor: typeConfig.bg.replace('bg-', '').replace('/10', ''), // Simplified for demo
        borderColor: typeConfig.color.replace('text-', '').replace('/10', ''),
      }}
    >
      <Icon className={cn('w-3 h-3', typeConfig.color)} />
      <span className={typeConfig.color}>
        {data.type.charAt(0).toUpperCase() + data.type.slice(1)} {actionConfig.label}
        {data.count !== undefined && data.count > 1 && (
          <span className="ml-1">({data.count})</span>
        )}
      </span>
    </motion.div>
  );
};
