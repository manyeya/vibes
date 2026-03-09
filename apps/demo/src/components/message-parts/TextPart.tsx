import React from 'react';
import { Streamdown } from 'streamdown';

interface TextPartProps {
  text: string;
  isUser: boolean;
}

export const TextPart: React.FC<TextPartProps> = ({ text, isUser }) => {
  return (
    <div className="streamdown overflow-x-auto text-[0.96rem] leading-7 text-inherit">
      <Streamdown>{text}</Streamdown>
    </div>
  );
};
