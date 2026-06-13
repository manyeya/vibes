import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { DataPartRenderer } from '../data-parts';
import { ActivityStream, StatusStrip, meaningfulMessage, type ActivityStreamPart } from './ActivityStream';

// Parts aggregated by the strip/stream above, or shown elsewhere (clarification
// form, context gauge) — never rendered as their own cards here.
const SUPPRESSED = new Set([
  'data-tool_progress',
  'data-status',
  'data-task_update',
  'data-task_graph',
  'data-clarification',
  'data-plan_review',
  'data-context_usage',
  'data-command',
  'data-file_operation',
  'data-skill',
  'data-search',
  'data-summarization',
  'data-error',
  'data-memory_update',
  'data-delegation',
  'data-artifact',
  'data-agent_message',
  'data-agent_thought',
]);

/**
 * Live "what's happening now" panel that sits ABOVE the composer rather than in
 * the chat stream. Tool runs, delegations and status are process, not
 * conversation. Durable output cards (file writes, commands, artifacts, errors)
 * render in the live assistant turn; this strip stays bounded + scrolls so a
 * big fan-out can't shove the composer down. Clears when the turn ends.
 */
export const LiveActivity: React.FC<{ parts: ActivityStreamPart[] }> = ({ parts }) => {
  const ref = useRef<HTMLDivElement>(null);
  // Always starts collapsed — it's an ambient peek, not a wall to wade past.
  const [collapsed, setCollapsed] = useState(true);
  const toggle = () => setCollapsed((c) => !c);

  // Follow the newest activity as it streams in (only while open).
  useEffect(() => {
    if (collapsed) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [parts, collapsed]);

  // Newest single activity line for the collapsed bar — prefer a real outcome
  // ("Found 0 files") over generic lifecycle text ("list_files complete"), so
  // the one-line pulse is actually informative without expanding.
  const latest = useMemo(() => {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.type === 'data-tool_progress') {
        const d = p.data as { toolName?: string; stage?: string; message?: string } | undefined;
        const toolName = d?.toolName ?? 'tool';
        const detail = meaningfulMessage(toolName, d?.message);
        // Keep the tool name for context — "webSearch · 10 results" beats a
        // bare "10 results" you can't trace back to a tool.
        if (detail) return `${toolName} · ${detail}`;
        const stage = d?.stage === 'in_progress' ? 'running' : d?.stage ?? 'running';
        return `${toolName} ${stage}`;
      }
      if (p.type === 'data-status') {
        const d = p.data as { message?: string } | undefined;
        if (d?.message) return d.message;
      }
    }
    return null;
  }, [parts]);

  const cards = parts.filter((p) => !SUPPRESSED.has(p.type));
  // Only render when there's something real: a card (delegation/error/…) or a
  // tool/status line. Suppressed chatter alone (context-usage, heartbeats)
  // must NOT pop an empty shell.
  if (cards.length === 0 && !latest) return null;

  return (
    <div className="mx-auto mb-2 max-w-3xl overflow-hidden rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[color:var(--color-ground)]/40"
      >
        <span className="dot-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-amber)]" aria-hidden />
        {collapsed && latest ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[color:var(--color-ink-soft)]">
            <span className="text-[color:var(--color-amber)]">→</span> {latest}
          </span>
        ) : (
          <>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
              Activity
            </span>
            {cards.length > 0 && (
              <span className="font-mono text-[10px] text-[color:var(--color-ink-faint)] opacity-70">{cards.length}</span>
            )}
          </>
        )}
        <ChevronDown
          className={cn(
            'ml-auto h-3.5 w-3.5 text-[color:var(--color-ink-faint)] transition-transform',
            collapsed && '-rotate-90',
          )}
        />
      </button>
      {!collapsed && (
        <div ref={ref} className="max-h-[36vh] space-y-3 overflow-y-auto border-t border-[color:var(--color-line)] px-3 py-3">
          <StatusStrip parts={parts} />
          <ActivityStream parts={parts} />
          {cards.length > 0 && (
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {cards.map((part) => (
                  <motion.div
                    key={part.key}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                  >
                    <DataPartRenderer part={part as any} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
