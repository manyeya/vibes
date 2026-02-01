import React from 'react';
import { motion } from 'framer-motion';
import { Send, MessageSquare } from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, type SwarmSignalData } from './types';

export const SwarmSignalPart: React.FC<{ data: SwarmSignalData }> = ({ data }) => {
  return (
    <motion.div
      {...animationProps}
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-xs text-indigo-400"
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
