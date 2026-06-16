import { useEffect, useRef, useState } from 'react';
import { Boxes, Check, ChevronsUpDown, FolderOpen, Plus, Settings2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Workspace } from './workspace-types';

interface WorkspaceSwitcherProps {
  workspaces: Workspace[];
  currentWorkspaceId: string;
  onSwitch: (id: string) => void;
  /** Create a new app-managed workspace by name; parent handles POST + select. */
  onCreate: (name: string) => void;
  /** Open the server-side folder chooser to pick an existing dir. */
  onRequestOpenFolder: () => void;
  /** Open the full Workspaces management page. */
  onManage: () => void;
}

/**
 * Compact project switcher pinned to the top of the session sidebar. Shows the
 * active workspace and opens a menu to switch, create, or manage workspaces —
 * the quick-switch shortcut that complements the full Workspaces page.
 */
export const WorkspaceSwitcher = ({
  workspaces,
  currentWorkspaceId,
  onSwitch,
  onCreate,
  onRequestOpenFolder,
  onManage,
}: WorkspaceSwitcherProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = workspaces.find((w) => w.id === currentWorkspaceId);

  // Dismiss on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleCreate = () => {
    setOpen(false);
    const name = window.prompt('New workspace name')?.trim();
    if (name) onCreate(name);
  };

  const handleOpenFolder = () => {
    setOpen(false);
    onRequestOpenFolder();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="group flex w-full items-center gap-2.5 rounded-lg border border-[color:var(--color-line)] bg-[rgba(244,238,228,0.03)] px-2.5 py-2 text-left transition-colors hover:border-[color:var(--color-line-strong)]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[rgba(244,238,228,0.05)] text-[color:var(--color-amber)]">
          <Boxes className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[9.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
            Workspace
          </span>
          <span className="block truncate text-[13px] font-medium text-[color:var(--color-ink)]">
            {current?.name ?? 'Default'}
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-[color:var(--color-ink-faint)]" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface)] shadow-xl"
        >
          <div className="max-h-64 overflow-y-auto py-1">
            {workspaces.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-[color:var(--color-ink-faint)]">No workspaces yet.</p>
            )}
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                role="option"
                aria-selected={w.id === currentWorkspaceId}
                onClick={() => { onSwitch(w.id); setOpen(false); }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-[rgba(244,238,228,0.05)]',
                  w.id === currentWorkspaceId ? 'text-[color:var(--color-ink)]' : 'text-[color:var(--color-ink-soft)]',
                )}
              >
                <Check className={cn('h-3.5 w-3.5 shrink-0', w.id === currentWorkspaceId ? 'text-[color:var(--color-amber)]' : 'opacity-0')} />
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {(w.metadata as { external?: boolean } | undefined)?.external && (
                  <FolderOpen className="h-3 w-3 shrink-0 text-[color:var(--color-ink-faint)]" />
                )}
                {typeof w.sessionCount === 'number' && (
                  <span className="shrink-0 font-mono text-[10px] text-[color:var(--color-ink-faint)]">{w.sessionCount}</span>
                )}
              </button>
            ))}
          </div>
          <div className="border-t border-[color:var(--color-line)] py-1">
            <button
              type="button"
              onClick={handleCreate}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[color:var(--color-ink-soft)] transition-colors hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" /> New workspace…
            </button>
            <button
              type="button"
              onClick={handleOpenFolder}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[color:var(--color-ink-soft)] transition-colors hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]"
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0" /> Open folder…
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); onManage(); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[color:var(--color-ink-soft)] transition-colors hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]"
            >
              <Settings2 className="h-3.5 w-3.5 shrink-0" /> Manage workspaces
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
