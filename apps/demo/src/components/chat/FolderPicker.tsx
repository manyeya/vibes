import { useCallback, useEffect, useState } from 'react';
import { Folder, ArrowUp, Home, X, Loader2, Check, MonitorUp } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Entry { name: string; isDir: boolean }
interface ListResponse {
  success: boolean;
  path?: string;
  parent?: string | null;
  home?: string;
  entries?: Entry[];
  error?: string;
}

interface FolderPickerProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen absolute server path. */
  onChoose: (path: string) => void;
}

/**
 * A server-side directory browser. A browser's native file dialog can't return
 * a real filesystem path (and the agent runs on the server, not the client), so
 * this walks the *server's* directories. On macOS a "Use Finder" button pops the
 * real native dialog instead.
 */
export const FolderPicker = ({ open, onClose, onChoose }: FolderPickerProps) => {
  const [path, setPath] = useState<string>('');
  const [parent, setParent] = useState<string | null>(null);
  const [home, setHome] = useState<string>('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (target?: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = target ? `?path=${encodeURIComponent(target)}` : '';
      const res = await fetch(`/api/fs/list${qs}`);
      const data: ListResponse = await res.json();
      if (data.success) {
        setPath(data.path ?? '');
        setParent(data.parent ?? null);
        setHome(data.home ?? '');
        setEntries(data.entries ?? []);
      } else {
        setError(data.error || 'Could not read that directory.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that directory.');
    } finally {
      setLoading(false);
    }
  }, []);

  // (Re)load from the home dir each time the picker opens.
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const pickNative = useCallback(async () => {
    try {
      const res = await fetch('/api/fs/pick-native', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.path) {
        onChoose(data.path);
        onClose();
      } else {
        setError(data.error || 'Native picker unavailable.');
      }
    } catch {
      setError('Native picker unavailable.');
    }
  }, [onChoose, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[color:var(--color-line)] px-4 py-3">
          <h2 className="font-display text-[17px] text-[color:var(--color-ink)]">Choose a folder</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-[color:var(--color-ink-faint)] transition-colors hover:text-[color:var(--color-ink)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Path bar */}
        <div className="flex items-center gap-1.5 border-b border-[color:var(--color-line)] px-3 py-2">
          <button
            type="button"
            onClick={() => home && load(home)}
            title="Home"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[color:var(--color-ink-faint)] transition-colors hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]"
          >
            <Home className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => parent && load(parent)}
            disabled={!parent}
            title="Up one level"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[color:var(--color-ink-faint)] transition-colors hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)] disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(path); }}
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-ground)] px-2.5 py-1.5 font-mono text-[12px] text-[color:var(--color-ink)] outline-none focus:border-[color:var(--color-amber)]"
          />
        </div>

        {/* Listing */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-[color:var(--color-ink-faint)]" /></div>
          ) : error ? (
            <p className="px-2 py-6 text-center text-[13px] text-[color:var(--color-ember)]">{error}</p>
          ) : entries.length === 0 ? (
            <p className="px-2 py-6 text-center text-[13px] text-[color:var(--color-ink-faint)]">No subfolders here.</p>
          ) : (
            <div className="space-y-0.5">
              {entries.map((e) => (
                <button
                  key={e.name}
                  type="button"
                  onClick={() => load(`${path.replace(/\/$/, '')}/${e.name}`)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-[color:var(--color-ink-soft)] transition-colors hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]"
                >
                  <Folder className="h-4 w-4 shrink-0 text-[color:var(--color-amber)]" />
                  <span className="min-w-0 truncate">{e.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-[color:var(--color-line)] px-3 py-3">
          <button
            type="button"
            onClick={pickNative}
            title="Open the native macOS folder dialog"
            className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-line-strong)] px-2.5 py-1.5 text-[12.5px] text-[color:var(--color-ink-soft)] transition-colors hover:border-[color:var(--color-amber)] hover:text-[color:var(--color-ink)]"
          >
            <MonitorUp className="h-3.5 w-3.5" /> Use Finder
          </button>
          <button
            type="button"
            onClick={() => { if (path) { onChoose(path); onClose(); } }}
            disabled={!path}
            className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-amber)] px-3.5 py-1.5 text-[13px] font-medium text-[color:var(--color-ground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Check className="h-4 w-4" /> Open this folder
          </button>
        </div>
      </div>
    </div>
  );
};
