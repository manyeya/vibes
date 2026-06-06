import { Bot, Loader2, Check, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface AgentTabInfo {
  /** 'main' for the orchestrator, otherwise the delegationId. */
  id: string;
  name: string;
  status: 'active' | 'complete' | 'failed';
  /** The task the sub-agent was delegated (shown in its isolated view). */
  task?: string;
}

const StatusIcon = ({ status }: { status: AgentTabInfo['status'] }) => {
  if (status === 'complete') return <Check className="h-3.5 w-3.5 text-[color:var(--color-moss)]" />;
  if (status === 'failed') return <X className="h-3.5 w-3.5 text-[color:var(--color-ember)]" />;
  return <Loader2 className="h-3.5 w-3.5 animate-spin text-[color:var(--color-amber)]" />;
};

/**
 * A switcher above the composer for the live activity rail: "Main agent" plus a
 * tab per deployed sub-agent. Selecting a tab filters the rail to that agent's
 * own work (its tool runs, commands, file ops). Hidden until at least one
 * sub-agent is deployed.
 */
export const AgentTabs = ({
  agents,
  active,
  onSelect,
}: {
  agents: AgentTabInfo[];
  active: string;
  onSelect: (id: string) => void;
}) => {
  if (agents.length <= 1) return null;

  return (
    <div className="mx-auto mb-2 flex max-w-3xl items-center gap-1 overflow-x-auto pb-0.5">
      <span className="shrink-0 pr-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-faint)]">
        view
      </span>
      {agents.map((a) => {
        const on = a.id === active;
        const isMain = a.id === 'main';
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(a.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors',
              on
                ? 'border-[color:var(--color-amber)]/60 bg-[rgba(224,164,88,0.1)] text-[color:var(--color-ink)]'
                : 'border-[color:var(--color-line)] text-[color:var(--color-ink-soft)] hover:border-[color:var(--color-line-strong)] hover:text-[color:var(--color-ink)]',
            )}
          >
            {isMain ? (
              <Bot className={cn('h-3.5 w-3.5', on ? 'text-[color:var(--color-amber)]' : 'text-[color:var(--color-ink-faint)]')} />
            ) : (
              <StatusIcon status={a.status} />
            )}
            <span className="max-w-[150px] truncate font-medium">{isMain ? 'Main agent' : a.name}</span>
          </button>
        );
      })}
    </div>
  );
};
