import React from 'react';
import { Markdown } from '../Markdown';

interface TextPartProps {
  text: string;
  isUser: boolean;
}

export const TextPart: React.FC<TextPartProps> = ({ text, isUser }) => {
  return (
    <div className="text-sm streamdown text-zinc-100 leading-relaxed overflow-x-auto">
      <Markdown>{text}</Markdown>
    </div>
  );
};
