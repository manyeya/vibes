import React from 'react';
import { motion } from 'framer-motion';
import { Info, AlertTriangle, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  notificationConfig,
  animationProps,
  dataPartStyles,
  type NotificationData,
} from './types';

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
        dataPartStyles.chip,
        config.bg,
        config.border
      )}
    >
      <Icon className={cn('w-3.5 h-3.5', config.text)} />
      <span className={config.text}>{data.message}</span>
    </motion.div>
  );
};
