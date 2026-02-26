import React from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '../../lib/utils';

interface TextPartProps {
  text: string;
  isUser: boolean;
}

export const TextPart: React.FC<TextPartProps> = ({ text, isUser }) => {
  return (
    <div className="text-sm streamdown text-zinc-100 leading-relaxed overflow-x-auto">
      <Streamdown>{text}</Streamdown>
    </div>
  );
};
