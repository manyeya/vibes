import React from 'react';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { animationProps, dataPartStyles, toneConfig, type StatusData } from './types';

export const StatusPart: React.FC<{ data: StatusData }> = ({ data }) => {
  const showProgress = data.step !== undefined && data.totalSteps !== undefined;
  const metadata = [data.plugin, data.agentName, data.phase].filter(Boolean).join(' · ');

  return (
    <motion.div
      {...animationProps}
      className={`${dataPartStyles.stack} ${toneConfig.neutral.bg} ${toneConfig.neutral.border} ${toneConfig.neutral.text}`}
    >
      <div className="inline-flex items-center gap-2">
        <Clock className="w-3 h-3" />
        <span>{data.message}</span>
        {showProgress && (
          <span className={toneConfig.neutral.muted}>
            ({data.step}/{data.totalSteps})
          </span>
        )}
      </div>
      {metadata && (
        <span className={dataPartStyles.meta}>{metadata}</span>
      )}
    </motion.div>
  );
};
