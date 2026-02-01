import React from 'react';
import { motion } from 'framer-motion';
import { Info, AlertTriangle, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { notificationConfig, animationProps, type NotificationData } from './types';

const iconMap = {
  Info,
  AlertTriangle,
  AlertCircle,
};

export const NotificationPart: React.FC<{ data: NotificationData }> = ({ data }) => {
  const config = notificationConfig[data.level];
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
      <Icon className={cn('w-3.5 h-3.5', config.color)} />
      <span className={config.color}>{data.message}</span>
    </motion.div>
  );
};
