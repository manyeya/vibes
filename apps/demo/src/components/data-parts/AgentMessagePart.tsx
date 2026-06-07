import React from 'react';
import { motion } from 'framer-motion';
import { Markdown } from '../Markdown';
import { animationProps, type AgentMessageData } from './types';

/**
 * A sub-agent's live narration / final answer, forwarded from its delegated run
 * and shown under that agent's tab. Streams in as the sub-agent writes.
 */
export const AgentMessagePart: React.FC<{ data: AgentMessageData }> = ({ data }) => {
  if (!data?.text) return null;
  return (
    <motion.div
      {...animationProps}
      className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface)] px-3 py-2"
    >
      <div className="streamdown text-[13.5px] leading-relaxed text-[color:var(--color-ink-soft)]">
        <Markdown>{data.text}</Markdown>
      </div>
    </motion.div>
  );
};
