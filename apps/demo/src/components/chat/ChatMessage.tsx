import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { TextPart, ReasoningPart } from '../message-parts';
import { DataPartRenderer, isDataPart } from '../data-parts';
import { ChatBubble } from './ChatBubble';
import { Avatar } from '../ui/Avatar';
import { ApprovalCard } from './ApprovalCard';

interface ChatMessageProps {
  message: any;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  // `live` = this is the in-flight turn; its tool/data activity is already
  // shown in the activity rail above, so render only text + reasoning here to
  // avoid double-printing the same work.
  live?: boolean;
}

/** Pretty millisecond format for tool-call elapsed time. */
function fmtMs(ms?: number): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m`;
}

interface ToolRow {
  key: string;
  toolName: string;
  detail?: string;
  elapsedMs?: number;
  status: 'ok' | 'error';
}

// One row per *real* tool call. The persisted parts (verified against the DB)
// arrive in execution order as:
//   SDK `tool-<name>` part (one per toolCallId)  →  opens the row
//   `data-tool_progress` chunks that follow it    →  enrich it (elapsed + msg)
// The agent-core wrapper always emits a generic "<tool> complete"; plugins may
// add a richer one ("Generated 8 tasks", "Wrote file.txt"). We open on the SDK
// part and fold every progress chunk up to the next SDK part into it, dropping
// the generic wrapper text in favour of a specific message when present. That
// collapses the old 2-3 rows per call (bare + complete + plugin) into one.
function assembleToolRows(parts: any[]): ToolRow[] {
  const rows: ToolRow[] = [];
  let current: ToolRow | null = null;
  const flush = () => {
    if (current) rows.push(current);
    current = null;
  };
  const isGeneric = (msg: string | undefined, tool: string) =>
    !msg ||
    msg === `${tool} complete` ||
    msg === `Starting ${tool}` ||
    msg === `Running ${tool}`;

  for (const part of parts) {
    const type = part?.type as string | undefined;
    if (!type) continue;

    const isToolPart = type.startsWith('tool-') || type === 'dynamic-tool';
    const isTerminal = ['output-available', 'output-error', 'output-denied'].includes(part.state);
    if (isToolPart && isTerminal && part.toolCallId) {
      flush();
      current = {
        key: part.toolCallId,
        toolName: part.toolName || part.name || type.replace(/^tool-/, ''),
        status: part.state === 'output-error' || part.state === 'output-denied' ? 'error' : 'ok',
      };
      continue;
    }

    if (type === 'data-tool_progress') {
      const d = (part.data ?? {}) as {
        toolName?: string;
        stage?: string;
        message?: string;
        elapsedMs?: number;
      };
      if (d.stage !== 'complete' && d.stage !== 'failed') continue;
      const toolName: string = d.toolName ?? current?.toolName ?? 'tool';
      // A tool that reported only via progress (no SDK part) still gets a row.
      if (!current) current = { key: `progress-${rows.length}`, toolName, status: 'ok' };
      if (d.elapsedMs != null) current.elapsedMs = Math.max(current.elapsedMs ?? 0, d.elapsedMs);
      if (d.stage === 'failed') current.status = 'error';
      if (d.message && !isGeneric(d.message, toolName)) current.detail = d.message;
    }
  }
  flush();
  return rows;
}

/**
 * The per-message tool log. A long turn can rack up a dozen+ calls, so this
 * collapses to a one-line summary ("✓ 14 steps") by default once there are
 * more than a few rows — click to expand the full list. Short logs stay open.
 */
const ToolLog: React.FC<{ rows: ToolRow[] }> = ({ rows }) => {
  const [collapsed, setCollapsed] = useState(rows.length > 4);
  const errorCount = rows.filter((r) => r.status === 'error').length;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 font-mono text-[12px] leading-[18px] text-[color:var(--color-ink-faint)] transition-colors hover:text-[color:var(--color-ink-soft)]"
      >
        <ChevronRight
          aria-hidden
          className={cn('h-3 w-3 shrink-0 transition-transform', !collapsed && 'rotate-90')}
        />
        <span className={errorCount ? 'text-[color:var(--color-ember)]' : 'text-[color:var(--color-moss)]'}>
          {errorCount ? '×' : '✓'}
        </span>
        <span className="text-[color:var(--color-ink-soft)]">
          {rows.length} step{rows.length === 1 ? '' : 's'}
        </span>
        {errorCount > 0 && (
          <span className="text-[color:var(--color-ember)]">· {errorCount} failed</span>
        )}
      </button>
      {!collapsed && (
        <ul className="mt-1 space-y-[3px] pl-5">
          {rows.map((row) => {
            const elapsed = fmtMs(row.elapsedMs);
            return (
              <li
                key={row.key}
                className="group flex items-center gap-3 font-mono text-[12px] leading-[18px] text-[color:var(--color-ink-soft)]"
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex h-[14px] w-[14px] shrink-0 items-center justify-center text-[10px]',
                    row.status === 'error'
                      ? 'text-[color:var(--color-ember)]'
                      : 'text-[color:var(--color-moss)]'
                  )}
                >
                  {row.status === 'error' ? '×' : '✓'}
                </span>
                <span className="shrink-0 text-[color:var(--color-ink)]">
                  {row.toolName}
                </span>
                {row.detail && (
                  <span className="min-w-0 flex-1 truncate text-[color:var(--color-ink-soft)]">
                    {row.detail}
                  </span>
                )}
                {elapsed && (
                  <span className="shrink-0 text-[11px] uppercase tracking-[0.05em] text-[color:var(--color-ink-faint)]">
                    {elapsed}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export const ChatMessage = ({ message, onApprove, onDeny, live = false }: ChatMessageProps) => {
  const isUser = message.role === 'user';
  const allParts = (message as any).parts || [];
  // For the in-flight turn, render conversational content plus durable data
  // cards (file writes, commands, artifacts, errors) immediately. Noisy
  // progress/status parts are filtered below and stay in the activity strip.
  const parts = live
    ? allParts.filter(
        (p: any) =>
          p?.type === 'text' ||
          p?.type === 'reasoning' ||
          p?.type === 'thinking' ||
          p?.approval?.id ||
          isDataPart(p) ||
          (p?.type === 'data' && isDataPart(p.data)),
      )
    : allParts;

  const seenToolApprovals = new Set<string>();

  // One clean row per real tool call (see assembleToolRows). Suppressed on the
  // live turn — progress/status owns tool display while streaming.
  const toolRows = live ? [] : assembleToolRows(allParts);

  // Collapse every reasoning/thinking block in the turn into a single
  // accumulating "Thinking" bubble (matching how a sub-agent's thoughts feed
  // into one bubble) instead of one bubble per step. Each block is kept as its
  // own segment so the bubble can link them on a rail; rendered in place of the
  // first reasoning part so it stays above the final answer.
  const reasoningSegments = parts
    .filter((p: any) => p.type === 'reasoning' || p.type === 'thinking')
    .map((p: any) => (p.text ?? '').trim())
    .filter(Boolean);
  let reasoningRendered = false;

  const renderedParts = parts.map((part: any, partIndex: number) => {
    if (part.type === 'text') {
      return <TextPart key={`text-${partIndex}`} text={part.text} isUser={isUser} />;
    }
    if (part.type === 'reasoning' || part.type === 'thinking') {
      if (reasoningRendered) return null;
      reasoningRendered = true;
      return <ReasoningPart key="reasoning" segments={reasoningSegments} />;
    }

    // data-tool_progress chunks are aggregated into the tool log by
    // assembleToolRows (one row per real call) — never rendered as cards here.
    if (part.type === 'data-tool_progress') return null;

    // Other data parts (errors, summaries, …) still render. Suppress the
    // noisier ones aggregated elsewhere — status, and task updates/graph which
    // now live in the sticky checklist above the composer.
    if (part.type === 'data-status') return null;
    if (part.type === 'data-task_update' || part.type === 'data-task_graph') return null;
    if (part.type === 'data-clarification') return null; // shown as the form above the composer
    if (part.type === 'data-context_usage') return null; // shown as the gauge in the composer footer
    if (isDataPart(part)) {
      // Sub-agent detail (anything carrying a delegationId that isn't the
      // delegation summary itself) belongs to that agent's tab, not the main
      // thread — so the thread keeps just the one-line delegation summary
      // instead of piling each sub-agent's cards above the messages that follow.
      const pdata = (part.data ?? {}) as { delegationId?: string };
      if (pdata.delegationId && part.type !== 'data-delegation') return null;
      return <DataPartRenderer key={`data-${partIndex}`} part={part} />;
    }
    if (part.type === 'data' && isDataPart(part.data)) {
      return <DataPartRenderer key={`data-${partIndex}`} part={part.data} />;
    }

    const needsApproval = part.state === 'call' || part.state === 'approval-requested' || part.state === 'input-available';
    if (needsApproval && part.toolCallId && !seenToolApprovals.has(part.toolCallId) && part.approval?.id) {
      seenToolApprovals.add(part.toolCallId);
      return (
        <ApprovalCard
          key={`approval-${part.toolCallId}`}
          toolName={part.toolName || part.name || 'Unknown Tool'}
          args={part.args || part.input || {}}
          approvalId={part.approval.id}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      );
    }

    // Terminal `tool-<name>` parts are folded into the tool log by
    // assembleToolRows above; nothing to render inline here.
    return null;
  });

  const hasContent = renderedParts.some((p: React.ReactNode) => p !== null)
    || toolRows.length > 0
    || (!isUser && (message as any).usage);

  if (!isUser && !hasContent) return null;

  const hasComplexContent =
    toolRows.length > 0 ||
    renderedParts.some((p: React.ReactNode) =>
      p && React.isValidElement(p) && p.type !== TextPart
    );

  const toolLog = toolRows.length > 0 ? <ToolLog rows={toolRows} /> : null;

  if (!hasComplexContent) {
    return (
      <ChatBubble role={isUser ? 'user' : 'assistant'}>
        {renderedParts}
      </ChatBubble>
    );
  }

  return (
    <div className={cn("flex gap-3 mb-6", isUser && "flex-row-reverse")}>
      <Avatar type={isUser ? 'user' : 'bot'} size="md" />
      <div className={cn("flex-1 min-w-0 space-y-2", isUser && "flex flex-col items-end")}>
        {renderedParts}
        {toolLog}
        {!isUser && (message as any).usage && (
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
            {(message as any).usage.promptTokens + (message as any).usage.completionTokens} tokens
          </div>
        )}
      </div>
    </div>
  );
};
