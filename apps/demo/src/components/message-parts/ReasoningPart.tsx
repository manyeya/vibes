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
      <summary className="flex cursor-pointer select-none items-center gap-2 rounded-[0.95rem] px-3 py-2 text-xs transition-colors hover:bg-[color:color-mix(in_srgb,var(--surface-raised)_82%,transparent)]">
        <Brain className="h-3.5 w-3.5 text-[var(--muted)]" />
        <Badge variant="zinc" size="sm">Thinking</Badge>
        <ChevronDown className="ml-auto h-3.5 w-3.5 text-[var(--muted)] transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2 rounded-[1rem] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface-muted)_86%,transparent)] px-3 py-2">
        <pre className="whitespace-pre-wrap font-mono text-xs text-[var(--muted)]">
          {text}
        </pre>
      </div>
    </details>
  );
};
