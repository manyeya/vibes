import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { animationProps, type TaskGraphData, taskStatusConfig, priorityConfig } from './types';

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
      className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700"
    >
      <div className="text-xs text-zinc-400 mb-2 font-medium">Task Dependencies</div>
      
      {/* Nodes */}
      <div className="space-y-1.5 mb-3">
        {data.nodes.map((node) => (
          <div
            key={node.id}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded text-xs',
              taskStatusConfig[node.status as keyof typeof taskStatusConfig]?.bg || 'bg-zinc-800/50',
              taskStatusConfig[node.status as keyof typeof taskStatusConfig]?.border || 'border-zinc-700'
            )}
          >
            <span className={taskStatusConfig[node.status as keyof typeof taskStatusConfig]?.text || 'text-zinc-400'}>
              {iconMap[node.status] || '○'}
            </span>
            <span className="text-zinc-300">{node.title}</span>
            {node.priority && (
              <span
                className={cn(
                  'ml-auto w-1.5 h-1.5 rounded-full',
                  priorityConfig[node.priority as keyof typeof priorityConfig]?.bg || 'bg-zinc-500'
                )}
              />
            )}
          </div>
        ))}
      </div>
      
      {/* Edges */}
      {data.edges.length > 0 && (
        <div className="space-y-1 pt-2 border-t border-zinc-700/50">
          {data.edges.map((edge, index) => (
            <div key={index} className="text-[10px] text-zinc-500 flex items-center justify-center">
              <span className="text-zinc-400">{edge.from}</span>
              <span className="mx-2">{edgeTypeMap[edge.type]}</span>
              <span className="text-zinc-400">{edge.to}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
};
