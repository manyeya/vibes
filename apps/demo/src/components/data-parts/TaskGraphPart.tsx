import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import {
  animationProps,
  dataPartStyles,
  toneConfig,
  type TaskGraphData,
  taskStatusConfig,
  priorityConfig,
} from './types';

const iconMap: Record<string, string> = {
  pending: '○',
  in_progress: '●',
  blocked: '⊘',
  completed: '✓',
  failed: '✗',
};

const edgeTypeMap: Record<string, string> = {
  blocks: '→ blocks →',
  blockedBy: '← blocked by ←',
  related: '↔ related ↔',
};

export const TaskGraphPart: React.FC<{ data: TaskGraphData }> = ({ data }) => {
  return (
    <motion.div
      {...animationProps}
      className={`${dataPartStyles.panel} ${toneConfig.neutral.bg} ${toneConfig.neutral.border}`}
    >
      <div className={`${dataPartStyles.label} mb-2`}>Task dependencies</div>

      <div className="space-y-1.5 mb-3">
        {data.nodes.map((node) => (
          <div
            key={node.id}
            className={cn(
              'flex items-center gap-2 rounded-[0.9rem] border px-2.5 py-2 text-xs',
              taskStatusConfig[node.status as keyof typeof taskStatusConfig]?.bg || toneConfig.neutral.bg,
              taskStatusConfig[node.status as keyof typeof taskStatusConfig]?.border || toneConfig.neutral.border
            )}
          >
            <span className={taskStatusConfig[node.status as keyof typeof taskStatusConfig]?.text || toneConfig.neutral.muted}>
              {iconMap[node.status] || '○'}
            </span>
            <span className={toneConfig.neutral.text}>{node.title}</span>
            {node.priority && (
              <span
                className={cn(
                  'ml-auto h-1.5 w-1.5 rounded-full',
                  priorityConfig[node.priority as keyof typeof priorityConfig]?.bg || toneConfig.neutral.dot
                )}
              />
            )}
          </div>
        ))}
      </div>

      {data.edges.length > 0 && (
        <div className="space-y-1 border-t border-[var(--tone-neutral-border)] pt-2">
          {data.edges.map((edge, index) => (
            <div key={index} className="flex items-center justify-center text-[10px] text-[var(--tone-neutral-muted)]">
              <span className={toneConfig.neutral.text}>{edge.from}</span>
              <span className="mx-2">{edgeTypeMap[edge.type]}</span>
              <span className={toneConfig.neutral.text}>{edge.to}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
};
