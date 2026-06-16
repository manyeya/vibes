import { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Check, X, ChevronDown } from 'lucide-react';
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

const Pill = ({
  agent,
  on,
  onClick,
  isMain = false,
}: {
  agent: AgentTabInfo;
  on: boolean;
  onClick: () => void;
  isMain?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={agent.task ?? agent.name}
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
      <StatusIcon status={agent.status} />
    )}
    <span className="max-w-[130px] truncate font-medium">{isMain ? 'Main agent' : agent.name}</span>
  </button>
);

/**
 * Switcher above the composer for the live activity rail: "Main agent" plus the
 * deployed sub-agents. Main is pinned (always reachable); in-flight workers stay
 * visible; finished ones collapse into a compact "✓N ✗N done ▾" menu so a run
 * that fans out to many sub-agents doesn't sprawl across the composer.
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  if (agents.length <= 1) return null;

  const main = agents.find((a) => a.id === 'main');
  const subs = agents.filter((a) => a.id !== 'main');
  const activeSubs = subs.filter((a) => a.status === 'active');
  const doneSubs = subs.filter((a) => a.status !== 'active');

  // Keep the currently-selected sub visible inline even if it's finished.
  const selectedDone = doneSubs.find((a) => a.id === active);
  const inlineSubs = [...activeSubs, ...(selectedDone ? [selectedDone] : [])];
  const collapsed = doneSubs.filter((a) => a.id !== selectedDone?.id);

  // Few sub-agents → just show them all (no need to collapse).
  const collapse = subs.length > 4;
  const completed = collapsed.filter((a) => a.status === 'complete').length;
  const failed = collapsed.filter((a) => a.status === 'failed').length;

  return (
    <div className="mx-auto mb-2 flex max-w-3xl items-center gap-1 pb-0.5">
      <span className="shrink-0 pr-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-faint)]">
        view
      </span>

      {/* Main agent — pinned, always reachable. */}
      {main && <Pill agent={main} on={active === 'main'} onClick={() => onSelect('main')} isMain />}

      {/* In-flight (and the selected) sub-agents — scroll if there are many. */}
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {(collapse ? inlineSubs : subs).map((a) => (
          <Pill key={a.id} agent={a} on={a.id === active} onClick={() => onSelect(a.id)} />
        ))}
      </div>

      {/* Finished sub-agents — collapsed into a compact menu. */}
      {collapse && collapsed.length > 0 && (
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-[color:var(--color-line)] px-2.5 py-1.5 text-[12px] text-[color:var(--color-ink-soft)] transition-colors hover:border-[color:var(--color-line-strong)] hover:text-[color:var(--color-ink)]"
          >
            {completed > 0 && (
              <span className="flex items-center gap-0.5 text-[color:var(--color-moss)]">
                <Check className="h-3 w-3" />
                {completed}
              </span>
            )}
            {failed > 0 && (
              <span className="flex items-center gap-0.5 text-[color:var(--color-ember)]">
                <X className="h-3 w-3" />
                {failed}
              </span>
            )}
            <span>done</span>
            <ChevronDown className="h-3 w-3" />
          </button>

          {menuOpen && (
            <div className="absolute bottom-[calc(100%+4px)] right-0 z-50 max-h-64 w-56 overflow-y-auto rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface)] py-1 shadow-xl">
              {collapsed.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => { onSelect(a.id); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] text-[color:var(--color-ink-soft)] transition-colors hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]"
                >
                  <StatusIcon status={a.status} />
                  <span className="min-w-0 flex-1 truncate" title={a.task ?? a.name}>{a.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
