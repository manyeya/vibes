import React from 'react';
import { motion } from 'framer-motion';
import { Send } from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, dataPartStyles, toneConfig, type SwarmSignalData } from './types';

export const SwarmSignalPart: React.FC<{ data: SwarmSignalData }> = ({ data }) => {
  return (
    <motion.div
      {...animationProps}
      className={cn(
        dataPartStyles.chip,
        toneConfig.secondary.bg,
        toneConfig.secondary.border,
        toneConfig.secondary.text
      )}
    >
      <Send className="w-3 h-3" />
      <span>
        Signal from <span className="font-medium">{data.from}</span>
        {data.to && (
          <span>
            {' '}to <span className="font-medium">{data.to}</span>
          </span>
        )}
        : {data.signal}
      </span>
    </motion.div>
  );
};
