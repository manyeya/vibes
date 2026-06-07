import React from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import { Badge } from '../ui/Badge';

interface ReasoningPartProps {
  text?: string;
  /**
   * Distinct thought blocks (one per reasoning step). When more than one is
   * present they render as nodes on a connecting rail so the flow of thoughts
   * is easy to track; a single block falls back to a plain pre.
   */
  segments?: string[];
}

export const ReasoningPart: React.FC<ReasoningPartProps> = ({ text = '', segments }) => {
  const items = (segments && segments.length > 0 ? segments : text ? [text] : [])
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);

  // Don't render if there's no content - prevents empty bubbles before reasoning arrives
  if (items.length === 0) {
    return null;
  }

  return (
    <details className="group" open>
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 rounded-md transition-colors select-none text-xs">
        <Brain className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
        <Badge variant="zinc" size="sm">Thinking</Badge>
        {items.length > 1 && (
          <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">{items.length}</span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-500 ml-auto group-open:rotate-180 transition-transform" />
      </summary>
      <div className="mt-2 px-3 py-2 bg-zinc-100 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-md">
        {items.length === 1 ? (
          <pre className="text-xs text-zinc-600 dark:text-zinc-500 whitespace-pre-wrap font-mono">
            {items[0]}
          </pre>
        ) : (
          <ol className="relative space-y-3 pl-4">
            {/* The rail that links each thought into one trackable thread. */}
            <span
              aria-hidden
              className="pointer-events-none absolute left-[3px] top-[6px] bottom-[6px] w-px bg-zinc-300 dark:bg-zinc-700"
            />
            {items.map((seg, i) => (
              <li key={i} className="relative">
                <span
                  aria-hidden
                  className="absolute -left-4 top-[5px] h-1.5 w-1.5 rounded-full bg-zinc-400 ring-2 ring-zinc-100 dark:bg-zinc-600 dark:ring-zinc-900"
                />
                <pre className="text-xs text-zinc-600 dark:text-zinc-500 whitespace-pre-wrap font-mono">
                  {seg}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
};
