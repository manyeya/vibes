import React from 'react';
import { Brain, ChevronDown } from 'lucide-react';

interface ReasoningPartProps {
  text?: string;
}

export const ReasoningPart: React.FC<ReasoningPartProps> = ({ text = '' }) => {
  return (
    <details className="group">
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-800/50 rounded-lg transition-colors select-none text-xs">
        <Brain className="w-3.5 h-3.5 text-violet-400" />
        <span className="text-zinc-400">Thinking</span>
        <ChevronDown className="w-3.5 h-3.5 text-zinc-500 ml-auto group-open:rotate-180 transition-transform" />
      </summary>
      <div className="mt-2 px-3 py-2 bg-violet-500/5 border border-violet-500/10 rounded-lg">
        <pre className="text-xs text-zinc-500 whitespace-pre-wrap font-mono">
          {text}
        </pre>
      </div>
    </details>
  );
};
