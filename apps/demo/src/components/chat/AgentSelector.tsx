import { useEffect, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface AgentOption {
  name: string;
  description: string;
}

interface AgentSelectorProps {
  agents: AgentOption[];
  /** Selected agent name, or '' for Auto (the orchestrator decides). */
  value: string;
  onChange: (name: string) => void;
  placement?: 'top' | 'bottom';
}

/**
 * Composer control to target a message at a specific sub-agent. 'Auto' (the
 * default) lets the main agent orchestrate; picking an agent routes the next
 * message to it via delegation. Mirrors the ModelSelector's look.
 */
export const AgentSelector = ({ agents, value, onChange, placement = 'top' }: AgentSelectorProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = agents.find((a) => a.name === value);
  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Target a sub-agent for this message"
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] transition-colors',
          current
            ? 'bg-[rgba(240,184,108,0.12)] text-[color:var(--color-amber)]'
            : 'text-[color:var(--color-ink-faint)] hover:bg-[color:var(--color-surface)] hover:text-[color:var(--color-ink-soft)]',
        )}
      >
        {current ? <Bot className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
        <span className="max-w-[120px] truncate">{current ? `@${current.name}` : 'Auto'}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <div
          className={cn(
            'absolute left-0 z-30 w-72 overflow-hidden rounded-xl border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] shadow-xl shadow-black/40',
            placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          <div className="border-b border-[color:var(--color-line)] px-3 py-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
              Route to agent
            </span>
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            <AgentRow
              active={value === ''}
              icon={Sparkles}
              name="Auto"
              description="Let the main agent orchestrate and delegate as needed."
              onClick={() => pick('')}
            />
            {agents.map((a) => (
              <AgentRow
                key={a.name}
                active={value === a.name}
                icon={Bot}
                name={a.name}
                description={a.description}
                onClick={() => pick(a.name)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const AgentRow = ({
  active,
  icon: Icon,
  name,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ElementType;
  name: string;
  description: string;
  onClick: () => void;
}) => (
  <li>
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[rgba(244,238,228,0.04)]"
    >
      <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', active ? 'text-[color:var(--color-amber)]' : 'text-[color:var(--color-ink-faint)]')} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[12px] text-[color:var(--color-ink)]">{name}</span>
          {active && <Check className="h-3 w-3 text-[color:var(--color-amber)]" />}
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-[color:var(--color-ink-faint)]">{description}</span>
      </span>
    </button>
  </li>
);
