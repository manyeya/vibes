import { useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { X, Plus, Loader2, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { SessionCard } from './SessionCard';
import type { Session } from './session-types';

/** Relative "time ago" label for a session's last activity. */
function timeAgo(iso?: string): string | undefined {
  if (!iso) return undefined;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return undefined;
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const MIN_W = 240;
const MAX_W = 480;

interface SessionSidebarProps {
  sessions: Session[];
  currentSessionId: string;
  isLoading: boolean;
  onSessionSelect: (id: string) => void;
  onCreate: (title: string) => void;
  onDeleteSession: (id: string) => void;
  onClose: () => void;
}

export const SessionSidebar = ({
  sessions,
  currentSessionId,
  isLoading,
  onSessionSelect,
  onCreate,
  onDeleteSession,
  onClose,
}: SessionSidebarProps) => {
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('vibes_sidebar_width'));
    return saved >= MIN_W && saved <= MAX_W ? saved : 300;
  });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'oldest' | 'active'>('recent');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? sessions.filter(
          (s) =>
            (s.metadata?.title ?? 'Untitled session').toLowerCase().includes(q) ||
            s.id.toLowerCase().includes(q),
        )
      : sessions;
    const created = (s: Session) => new Date(s.createdAt).getTime() || 0;
    const touched = (s: Session) => new Date(s.updatedAt || s.createdAt).getTime() || 0;
    const sorted = [...matched];
    if (sort === 'oldest') sorted.sort((a, b) => created(a) - created(b));
    else if (sort === 'active') sorted.sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0));
    else sorted.sort((a, b) => touched(b) - touched(a));
    return sorted;
  }, [sessions, query, sort]);

  // Drag the right edge to resize. The sidebar hugs the viewport's left edge,
  // so its width is just the cursor's x, clamped.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const clamp = (w: number) => Math.min(MAX_W, Math.max(MIN_W, w));
    let last = width;
    const onMove = (ev: MouseEvent) => {
      last = clamp(ev.clientX);
      setWidth(last);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('vibes_sidebar_width', String(Math.round(last)));
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={onClose} />
      <aside
        style={{ width, maxWidth: '85vw' }}
        className="fixed left-0 top-0 bottom-0 z-50 flex flex-col border-r border-[color:var(--color-line)] bg-[color:var(--color-surface)] lg:relative lg:z-0"
      >
        {/* Drag-to-resize handle (desktop) */}
        <div
          onMouseDown={startResize}
          title="Drag to resize"
          className="group absolute right-0 top-0 z-10 hidden h-full w-1.5 translate-x-1/2 cursor-col-resize lg:block"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-[color:var(--color-amber)]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-5 pb-3">
          <div className="flex items-baseline gap-2.5">
            <h2 className="font-display text-[20px] leading-none text-[color:var(--color-ink)]">Sessions</h2>
            {sessions.length > 0 && (
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--color-ink-faint)]">
                {sessions.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded-md p-1 text-[color:var(--color-ink-faint)] transition-colors hover:text-[color:var(--color-ink)] lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* New session — creates an "Untitled session" straight away; it's
            renamed from the first message (see ChatArea). */}
        <div className="px-3 pb-2">
          <button
            onClick={() => onCreate('Untitled session')}
            className="group flex w-full items-center gap-2.5 rounded-lg border border-dashed border-[color:var(--color-line-strong)] px-3 py-2 text-left text-[13px] text-[color:var(--color-ink-soft)] transition-colors hover:border-[color:var(--color-amber)] hover:text-[color:var(--color-ink)]"
          >
            <Plus className="h-4 w-4 text-[color:var(--color-ink-faint)] transition-colors group-hover:text-[color:var(--color-amber)]" />
            New session
          </button>
        </div>

        {/* Search + sort */}
        {sessions.length > 0 && (
          <div className="space-y-1.5 px-3 pb-2">
            <div className="flex items-center gap-2 rounded-lg border border-[color:var(--color-line)] bg-[rgba(244,238,228,0.03)] px-2.5 py-1.5 transition-colors focus-within:border-[color:var(--color-line-strong)]">
              <Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-ink-faint)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sessions"
                className="w-full bg-transparent text-[12.5px] text-[color:var(--color-ink)] outline-none placeholder:text-[color:var(--color-ink-faint)]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="shrink-0 text-[color:var(--color-ink-faint)] transition-colors hover:text-[color:var(--color-ink)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              {(['recent', 'oldest', 'active'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSort(s)}
                  className={cn(
                    'rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors',
                    sort === s
                      ? 'bg-[color:var(--color-surface)] text-[color:var(--color-ink)]'
                      : 'text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink-soft)]',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-[color:var(--color-ink-faint)]" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-2 py-12 text-center">
              <p className="font-display text-[16px] text-[color:var(--color-ink-soft)]">
                {query ? 'No matches' : 'Nothing here yet'}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--color-ink-faint)]">
                {query ? 'Try a different search.' : 'Start a session above to begin.'}
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              <AnimatePresence initial={false}>
                {filtered.map((session) => (
                  <SessionCard
                    key={session.id}
                    id={session.id}
                    title={session.metadata?.title}
                    isActive={session.id === currentSessionId}
                    messageCount={session.messageCount}
                    timeLabel={timeAgo(session.updatedAt || session.createdAt)}
                    onSelect={() => {
                      onSessionSelect(session.id);
                      onClose();
                    }}
                    onDelete={() => onDeleteSession(session.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
