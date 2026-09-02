import React from 'react';
import { MessagesSquare, Settings, MessageSquareText, Boxes, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface LeftNavProps {
  /** Which top-level view is active. */
  active: 'chat' | 'settings' | 'prompts' | 'workspaces';
  /** Whether the session list is currently open (drives the Sessions highlight). */
  sessionsOpen: boolean;
  onToggleSessions: () => void;
  onOpenWorkspaces: () => void;
  onOpenPrompts: () => void;
  onOpenSettings: () => void;
}

const NavButton: React.FC<{
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ icon: Icon, label, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    aria-pressed={active}
    className={cn(
      'group relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
      active
        ? 'bg-[rgba(244,238,228,0.07)] text-[color:var(--color-amber)]'
        : 'text-[color:var(--color-ink-faint)] hover:bg-[rgba(244,238,228,0.04)] hover:text-[color:var(--color-ink)]',
    )}
  >
    {/* active indicator on the outer (left) edge — activity-bar style */}
    <span
      aria-hidden
      className={cn(
        'absolute left-0 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--color-amber)] transition-opacity',
        active ? 'opacity-100' : 'opacity-0',
      )}
    />
    <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
  </button>
);

/**
 * Thin icon rail pinned to the far-left edge (left of the session list):
 * Sessions at the top, Settings at the bottom. Keeps top-level navigation out
 * of the chat header.
 */
export const LeftNav: React.FC<LeftNavProps> = ({ active, sessionsOpen, onToggleSessions, onOpenWorkspaces, onOpenPrompts, onOpenSettings }) => {
  return (
    <nav className="flex h-full w-12 shrink-0 flex-col items-center justify-between border-r border-[color:var(--color-line)] bg-[color:var(--color-surface)] py-3">
      <div className="flex flex-col items-center gap-1.5">
        <NavButton
          icon={MessagesSquare}
          label="Sessions"
          active={active === 'chat' && sessionsOpen}
          onClick={onToggleSessions}
        />
        <NavButton
          icon={Boxes}
          label="Workspaces"
          active={active === 'workspaces'}
          onClick={onOpenWorkspaces}
        />
        <NavButton
          icon={MessageSquareText}
          label="Prompts"
          active={active === 'prompts'}
          onClick={onOpenPrompts}
        />
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <NavButton
          icon={Settings}
          label="Settings"
          active={active === 'settings'}
          onClick={onOpenSettings}
        />
      </div>
    </nav>
  );
};
