import React from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '../../lib/utils';

interface TextPartProps {
  text: string;
  isUser: boolean;
}

export const TextPart: React.FC<TextPartProps> = ({ text, isUser }) => {
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-2.5 text-sm streamdown",
        isUser
          ? "bg-cyan-500 text-white"
          : "bg-zinc-800/50 border border-zinc-800 text-zinc-200"
      )}
    >
      <Streamdown>{text}</Streamdown>
    </div>
  );
};
