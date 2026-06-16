import React, { useState } from 'react';
import { Boxes, Plus, Trash2, RefreshCw, Pencil, FolderOpen, FolderSymlink, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Workspace } from './chat/workspace-types';

const fieldClass =
  'w-full rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-ground)] px-2.5 py-1.5 text-[13px] text-[color:var(--color-ink)] outline-none transition-colors focus:border-[color:var(--color-amber)] placeholder:text-[color:var(--color-ink-faint)]';

interface WorkspacesPageProps {
  workspaces: Workspace[];
  currentWorkspaceId: string;
  isLoading: boolean;
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
  /** Open an existing folder on disk (by absolute server path) as a workspace. */
  onOpenFolder: (rootDir: string) => void;
  /** Open the server-side folder chooser modal. */
  onRequestOpenFolder: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}

const WorkspaceCard: React.FC<{
  workspace: Workspace;
  isActive: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}> = ({ workspace, isActive, onOpen, onRename, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workspace.name);
  const isDefault = workspace.id === 'default';
  const isExternal = Boolean((workspace.metadata as { external?: boolean } | undefined)?.external);

  const commit = () => {
    const next = name.trim();
    if (next && next !== workspace.name) onRename(next);
    setEditing(false);
  };

  return (
    <section
      className={cn(
        'rounded-xl border bg-[color:var(--color-surface)] p-4 transition-colors',
        isActive ? 'border-[color:var(--color-amber)]' : 'border-[color:var(--color-line)]',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(244,238,228,0.05)] text-[color:var(--color-amber)]">
          {isExternal ? <FolderSymlink className="h-4 w-4" strokeWidth={1.75} /> : <Boxes className="h-4 w-4" strokeWidth={1.75} />}
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                className={fieldClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setName(workspace.name); setEditing(false); } }}
              />
              <button type="button" onClick={commit} aria-label="Save name" className="shrink-0 rounded-md p-1.5 text-[color:var(--color-amber)] hover:bg-[rgba(244,238,228,0.05)]">
                <Check className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[15px] font-medium text-[color:var(--color-ink)]">{workspace.name}</h3>
              {isActive && (
                <span className="shrink-0 rounded-md bg-[rgba(244,238,228,0.06)] px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-[color:var(--color-amber)]">
                  Active
                </span>
              )}
              {isExternal && (
                <span className="shrink-0 rounded-md bg-[rgba(244,238,228,0.06)] px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-[color:var(--color-ink-faint)]">
                  Folder
                </span>
              )}
            </div>
          )}
          <p className="mt-1 truncate font-mono text-[11px] text-[color:var(--color-ink-faint)]">{workspace.rootDir}</p>
          <p className="mt-1 text-[12px] text-[color:var(--color-ink-soft)]">
            {workspace.sessionCount ?? 0} session{(workspace.sessionCount ?? 0) === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 border-t border-[color:var(--color-line)] pt-3">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-amber)] px-3 py-1.5 text-[12.5px] font-medium text-[color:var(--color-ground)] transition-opacity hover:opacity-90"
        >
          <FolderOpen className="h-3.5 w-3.5" /> Open
        </button>
        <button
          type="button"
          onClick={() => { setName(workspace.name); setEditing(true); }}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-[color:var(--color-ink-faint)] transition-colors hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]"
        >
          <Pencil className="h-3.5 w-3.5" /> Rename
        </button>
        {!isDefault && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-[color:var(--color-ink-faint)] transition-colors hover:bg-[rgba(239,108,79,0.1)] hover:text-[color:var(--color-ember)]"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        )}
      </div>
    </section>
  );
};

export const WorkspacesPage: React.FC<WorkspacesPageProps> = ({
  workspaces,
  currentWorkspaceId,
  isLoading,
  onOpen,
  onCreate,
  onOpenFolder,
  onRequestOpenFolder,
  onRename,
  onDelete,
  onRefresh,
}) => {
  const [newName, setNewName] = useState('');
  const [folderPath, setFolderPath] = useState('');

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName('');
  };

  const openFolder = () => {
    const dir = folderPath.trim();
    if (!dir) return;
    onOpenFolder(dir);
    setFolderPath('');
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-5 py-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-[24px] leading-none text-[color:var(--color-ink)]">Workspaces</h1>
            <p className="mt-1.5 text-[13px] text-[color:var(--color-ink-soft)]">
              A workspace is a project with its own shared directory. Every session inside it works on the same files.
            </p>
          </div>
          <button type="button" onClick={onRefresh} title="Refresh" aria-label="Refresh" className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[color:var(--color-ink-faint)] transition-colors hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]">
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} strokeWidth={1.75} />
          </button>
        </header>

        {/* New workspace (app-managed) */}
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-3">
          <input
            className={fieldClass}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
            placeholder="New workspace name (e.g. my-app)"
          />
          <button
            type="button"
            onClick={create}
            disabled={!newName.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[color:var(--color-amber)] px-3 py-1.5 text-[13px] font-medium text-[color:var(--color-ground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Create
          </button>
        </div>

        {/* Open an existing folder on disk (Codex / Claude-cowork style) */}
        <div className="mb-5 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRequestOpenFolder}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[color:var(--color-line-strong)] px-3 py-1.5 text-[13px] font-medium text-[color:var(--color-ink)] transition-colors hover:border-[color:var(--color-amber)]"
            >
              <FolderSymlink className="h-3.5 w-3.5" /> Choose folder…
            </button>
            <span className="text-[12px] text-[color:var(--color-ink-faint)]">or paste a path</span>
            <input
              className={cn(fieldClass, 'font-mono text-[12px]')}
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') openFolder(); }}
              placeholder="/absolute/path/to/folder"
            />
            {folderPath.trim() && (
              <button
                type="button"
                onClick={openFolder}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[color:var(--color-amber)] px-3 py-1.5 text-[13px] font-medium text-[color:var(--color-ground)] transition-opacity hover:opacity-90"
              >
                Open
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[color:var(--color-ink-faint)]">
            Point a workspace at a real project on the server. The agent works directly on its files;
            per-session scratch is kept outside the folder.
          </p>
        </div>

        {!isLoading && workspaces.length === 0 && (
          <p className="text-[13px] text-[color:var(--color-ink-faint)]">No workspaces yet — create one above.</p>
        )}

        {workspaces.length > 0 && (
          <div className="space-y-3">
            {workspaces.map((w) => (
              <WorkspaceCard
                key={w.id}
                workspace={w}
                isActive={w.id === currentWorkspaceId}
                onOpen={() => onOpen(w.id)}
                onRename={(name) => onRename(w.id, name)}
                onDelete={() => onDelete(w.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
