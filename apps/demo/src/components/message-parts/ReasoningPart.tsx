import React from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import { Badge } from '../ui/Badge';

interface ReasoningPartProps {
  text?: string;
}

export const ReasoningPart: React.FC<ReasoningPartProps> = ({ text = '' }) => {
  // Don't render if text is empty - this prevents empty bubbles before reasoning content arrives
  if (!text || text.trim().length === 0) {
    return null;
  }

  return (
    <details className="group" open>
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 rounded-md transition-colors select-none text-xs">
        <Brain className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
        <Badge variant="zinc" size="sm">Thinking</Badge>
        <ChevronDown className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-500 ml-auto group-open:rotate-180 transition-transform" />
      </summary>
      <div className="mt-2 px-3 py-2 bg-zinc-100 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-md">
        <pre className="text-xs text-zinc-600 dark:text-zinc-500 whitespace-pre-wrap font-mono">
          {text}
        </pre>
      </div>
    </details>
  );
};
