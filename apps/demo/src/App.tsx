import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import {
  Loader2,
  Send,
  User,
  Bot,
  Shield,
  Square,
  Plus,
  MessageSquare,
  History,
  RefreshCw,
  TreePine,
  ClipboardList,
  CheckCircle2,
  ChevronDown,
  X,
  PanelLeft,
  ArrowUp,
  Coins,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from './lib/utils';
import { DataPartRenderer, isDataPart } from './components/data-parts';
import { TextPart, ReasoningPart, ToolResultPart } from './components/message-parts';

// Import new Vercel-style UI components
import { Button } from './components/ui/Button';
import { Textarea } from './components/ui/Input';
import { Card } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import { Avatar } from './components/ui/Avatar';
import { IconButton } from './components/ui/IconButton';
import { Skeleton } from './components/ui/Skeleton';
import { Divider } from './components/ui/Divider';
import { ChatBubble } from './components/chat/ChatBubble';
import { TypingIndicator } from './components/chat/TypingIndicator';
import { SessionCard } from './components/chat/SessionCard';
import { ModelSelector, type ModelOption } from './components/chat/ModelSelector';
import { TaskChecklist, type ChecklistTask } from './components/chat/TaskChecklist';
import { AgentTabs, type AgentTabInfo } from './components/chat/AgentTabs';
import { ActivityStream, StatusStrip } from './components/chat/ActivityStream';
import { ArtifactPanel } from './components/artifacts/ArtifactPanel';
import { ArtifactsContext } from './components/artifacts/ArtifactsContext';
import type { ArtifactData } from './components/data-parts/types';

// ============ TYPES ============
interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface Session {
  id: string;
  metadata?: { title?: string; usage?: SessionUsage };
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  taskCount: number;
  fileCount: number;
}

interface Task {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'failed';
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

interface LiveDataPart {
  key: string;
  type: string;
  data: unknown;
}

// ============ APPROVAL CARD ============
interface ApprovalCardProps {
  toolName: string;
  args: any;
  approvalId: string;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

const ApprovalCard = ({ toolName, args, approvalId, onApprove, onDeny }: ApprovalCardProps) => {
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'y' || e.key === 'Y') {
        onApprove(approvalId);
      } else if (e.key === 'n' || e.key === 'N') {
        onDeny(approvalId);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [approvalId, onApprove, onDeny]);

  const formatJson = (obj: any, maxChars = 500): string => {
    const jsonStr = JSON.stringify(obj, null, 2);
    if (jsonStr.length <= maxChars) return jsonStr;
    return jsonStr.slice(0, maxChars) + '\n... (truncated)';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="border border-amber-300 dark:border-amber-900/50 rounded-lg overflow-hidden bg-amber-50 dark:bg-amber-950/20"
    >
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-950/30 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <div>
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Permission Required</span>
            <Badge variant="amber" size="sm" className="ml-2">{toolName}</Badge>
          </div>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-zinc-500 dark:text-zinc-500 transition-transform", isExpanded && "rotate-180")} />
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 space-y-3">
              <pre className="text-xs text-zinc-700 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-900/50 p-3 rounded-md overflow-auto max-h-48 font-mono">
                {formatJson(args)}
              </pre>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => onDeny(approvalId)}
                >
                  Deny (N)
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => onApprove(approvalId)}
                >
                  Approve (Y)
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ============ SESSION SIDEBAR ============
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

interface SessionSidebarProps {
  sessions: Session[];
  currentSessionId: string;
  isLoading: boolean;
  onSessionSelect: (id: string) => void;
  onCreate: (title: string) => void;
  onDeleteSession: (id: string) => void;
  onClose: () => void;
}

const SessionSidebar = ({
  sessions,
  currentSessionId,
  isLoading,
  onSessionSelect,
  onCreate,
  onDeleteSession,
  onClose,
}: SessionSidebarProps) => {
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating) inputRef.current?.focus();
  }, [isCreating]);

  const submit = () => {
    const title = draft.trim();
    onCreate(title || `Session ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
    setDraft('');
    setIsCreating(false);
  };
  const cancel = () => {
    setDraft('');
    setIsCreating(false);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={onClose} />
      <aside className="fixed left-0 top-0 bottom-0 z-50 flex w-[300px] flex-col border-r border-[color:var(--color-line)] bg-[color:var(--color-surface)] lg:static lg:z-0">
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

        {/* New session: inline create, not a modal */}
        <div className="px-3 pb-2">
          {isCreating ? (
            <div className="flex items-center gap-2 rounded-lg border border-[color:var(--color-line-strong)] bg-[rgba(244,238,228,0.04)] px-3 py-2 transition-colors focus-within:border-[color:var(--color-amber)]">
              <Plus className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-amber)]" />
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                  else if (e.key === 'Escape') cancel();
                }}
                onBlur={() => {
                  if (!draft.trim()) cancel();
                }}
                placeholder="Name this session"
                className="w-full bg-transparent text-[13px] text-[color:var(--color-ink)] outline-none placeholder:text-[color:var(--color-ink-faint)]"
              />
              <kbd className="font-mono text-[10px] text-[color:var(--color-ink-faint)]">↵</kbd>
            </div>
          ) : (
            <button
              onClick={() => setIsCreating(true)}
              className="group flex w-full items-center gap-2.5 rounded-lg border border-dashed border-[color:var(--color-line-strong)] px-3 py-2 text-left text-[13px] text-[color:var(--color-ink-soft)] transition-colors hover:border-[color:var(--color-amber)] hover:text-[color:var(--color-ink)]"
            >
              <Plus className="h-4 w-4 text-[color:var(--color-ink-faint)] transition-colors group-hover:text-[color:var(--color-amber)]" />
              New session
            </button>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-[color:var(--color-ink-faint)]" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-2 py-12 text-center">
              <p className="font-display text-[16px] text-[color:var(--color-ink-soft)]">Nothing here yet</p>
              <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--color-ink-faint)]">
                Start a session above to begin.
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              <AnimatePresence initial={false}>
                {sessions.map((session) => (
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

// ============ CHAT MESSAGE ============
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

const ChatMessage = ({ message, onApprove, onDeny, live = false }: ChatMessageProps) => {
  const isUser = message.role === 'user';
  const allParts = (message as any).parts || [];
  // For the in-flight turn, the activity rail above already shows tool runs and
  // data-part cards, so render only the conversational content (text/reasoning)
  // here to avoid duplicating it. Completed messages render everything inline.
  const parts = live
    ? allParts.filter(
        (p: any) =>
          p?.type === 'text' ||
          p?.type === 'reasoning' ||
          p?.type === 'thinking' ||
          p?.approval?.id,
      )
    : allParts;

  const seenToolApprovals = new Set<string>();

  // One clean row per real tool call (see assembleToolRows). Suppressed on the
  // live turn — the activity rail owns tool display while streaming.
  const toolRows = live ? [] : assembleToolRows(allParts);

  const renderedParts = parts.map((part: any, partIndex: number) => {
    if (part.type === 'text') {
      return <TextPart key={`text-${partIndex}`} text={part.text} isUser={isUser} />;
    }
    if (part.type === 'reasoning' || part.type === 'thinking') {
      return <ReasoningPart key={`reasoning-${partIndex}`} text={part.text} />;
    }

    // data-tool_progress chunks are aggregated into the tool log by
    // assembleToolRows (one row per real call) — never rendered as cards here.
    if (part.type === 'data-tool_progress') return null;

    // Other data parts (errors, summaries, …) still render. Suppress the
    // noisier ones aggregated elsewhere — status, and task updates/graph which
    // now live in the sticky checklist above the composer.
    if (part.type === 'data-status') return null;
    if (part.type === 'data-task_update' || part.type === 'data-task_graph') return null;
    if (isDataPart(part)) {
      // Sub-agent activity: parts carrying a delegationId are what a delegated
      // agent is *doing* (its commands, file ops, thoughts). Nest + label them
      // so you can see the sub-agent's work, not just "in progress".
      const pdata = (part.data ?? {}) as { delegationId?: string; agentName?: string };
      if (pdata.delegationId && part.type !== 'data-delegation') {
        const prevDelegationId = (parts[partIndex - 1]?.data as { delegationId?: string } | undefined)?.delegationId;
        const showLabel = pdata.delegationId !== prevDelegationId;
        return (
          <div key={`data-${partIndex}`} className="ml-3 border-l border-[color:var(--color-line)] pl-3">
            {showLabel && pdata.agentName && (
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-faint)]">
                ↳ {pdata.agentName}
              </div>
            )}
            <DataPartRenderer part={part} />
          </div>
        );
      }
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

  const ToolLog = toolRows.length > 0 ? (
    <ul className="mt-2 space-y-[3px]">
      {toolRows.map((row) => {
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
  ) : null;

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
        {ToolLog}
        {!isUser && (message as any).usage && (
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
            {(message as any).usage.promptTokens + (message as any).usage.completionTokens} tokens
          </div>
        )}
      </div>
    </div>
  );
};

// Data-part types aggregated elsewhere (activity rail, task checklist) and
// therefore NOT rendered as loose cards in the chat stream.
const SUPPRESSED_CHAT_PARTS = new Set([
  'data-tool_progress',
  'data-status',
  'data-task_update',
  'data-task_graph',
]);

// ============ MAIN CHAT AREA ============
function formatTokens(n: number): string {
  if (!n) return '0';
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function estimateCost(usage: SessionUsage | undefined, model: ModelOption | undefined): string {
  if (!usage) return '$0.00';
  const cost =
    (usage.inputTokens / 1_000_000) * (model?.priceIn ?? 0) +
    (usage.outputTokens / 1_000_000) * (model?.priceOut ?? 0);
  if (cost === 0) return '$0.00';
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

interface ChatAreaProps {
  sessionId: string;
  model?: string;
  models: ModelOption[];
  onModelChange: (id: string) => void;
  usage?: SessionUsage;
  onSessionUpdate: () => void;
}

const ChatArea = ({ sessionId, model, models, onModelChange, usage, onSessionUpdate }: ChatAreaProps) => {
  const [input, setInput] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [dataParts, setDataParts] = useState<LiveDataPart[]>([]);
  // Canvas panel: which artifact is focused, and whether the panel is open.
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Live activity rail: which agent's work is shown ('main' or a delegationId).
  const [activeAgent, setActiveAgent] = useState<string>('main');

  // Keep the selected model in a ref so the transport (created once) always
  // reads the latest value — including on automatic tool-approval resends.
  const modelRef = useRef(model);
  modelRef.current = model;

  const { messages, sendMessage, status, addToolApprovalResponse, error, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/vibe/stream',
      headers: { 'Content-Type': 'application/json' },
      prepareSendMessagesRequest: ({ body, messages }) => ({
        body: {
          ...(body ?? {}),
          messages,
          session_id: sessionId,
          model: modelRef.current || undefined,
        },
      }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,

    onData: (dataPart: any) => {
      const { type, data } = dataPart;

      const updateLiveDataParts = (mode: 'replace' | 'append' = 'replace') => {
        const stableId = typeof dataPart.id === 'string' && dataPart.id.length > 0
          ? `${type}:${dataPart.id}`
          : undefined;

        setDataParts(prev => {
          if (!stableId || mode === 'append') {
            return [
              ...prev,
              {
                key: stableId
                  ? `${stableId}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                  : `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                type,
                data,
              },
            ];
          }

          const nextPart: LiveDataPart = { key: stableId, type, data };
          const existingIndex = prev.findIndex(part => part.key === stableId);
          if (existingIndex === -1) {
            return [...prev, nextPart];
          }

          const next = [...prev];
          next[existingIndex] = nextPart;
          return next;
        });
      };

      switch (type) {
        // All data parts go to the chat display
        case 'data-task_update':
        case 'data-task_graph':
        case 'data-summarization':
        case 'data-tool_progress':
        case 'data-error':
        case 'data-memory_update':
        case 'data-delegation':
        case 'data-artifact':
        case 'data-agent_message':
        case 'data-agent_thought':
        case 'data-notification':
          updateLiveDataParts();
          break;

        case 'data-status': {
          const phase = typeof data === 'object' && data && 'phase' in data
            ? (data as { phase?: string }).phase
            : undefined;
          updateLiveDataParts(phase === 'heartbeat' ? 'replace' : 'append');
          break;
        }

        default:
          break;
      }
    },
  });

  // Load session history
  useEffect(() => {
    const fetchHistory = async () => {
      setIsLoadingHistory(true);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/messages`);
        const data = await res.json();
        if (data.success && data.messages?.length > 0) {
          setMessages(data.messages.map((msg: any) => ({
            id: msg.id,
            role: msg.role,
            parts: msg.parts || [],
          })));
        }
      } catch (err) {
        console.error('Failed to fetch history:', err);
      } finally {
        setIsLoadingHistory(false);
      }
    };
    fetchHistory();
  }, [sessionId, setMessages]);

  // Update session list when messages change
  useEffect(() => {
    if (!isLoadingHistory && status !== 'streaming') {
      onSessionUpdate();
    }
  }, [messages, status, isLoadingHistory, onSessionUpdate]);

  useEffect(() => {
    if (!isLoadingHistory && status !== 'streaming' && status !== 'submitted') {
      const timeoutId = window.setTimeout(() => {
        setDataParts([]);
      }, 2000);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }
  }, [status, isLoadingHistory]);

  const isLoading = status === 'streaming' || status === 'submitted' || isLoadingHistory;

  // Build the checklist from task data — streamed live AND persisted in
  // message parts. The `task_graph` carries the authoritative FULL task set
  // (with priority + handling clears) on every change, so prefer the latest
  // one; fall back to accumulating `task_update` parts only if no graph
  // exists. Pinned above the composer instead of scattered through the chat.
  const tasks = useMemo<ChecklistTask[]>(() => {
    let latestGraphNodes: any[] | null = null;
    const updateMap = new Map<string, ChecklistTask>();
    const scan = (type?: string, data?: any) => {
      if (type === 'data-task_graph' && Array.isArray(data?.nodes)) {
        latestGraphNodes = data.nodes;
      } else if (type === 'data-task_update' && data?.id) {
        const prev = updateMap.get(data.id);
        updateMap.set(data.id, {
          id: data.id,
          status: data.status ?? prev?.status ?? 'pending',
          title: data.title ?? prev?.title,
          priority: data.priority ?? prev?.priority,
        });
      }
    };
    for (const m of messages as any[]) {
      for (const p of (m?.parts ?? [])) scan(p?.type, p?.data);
    }
    for (const p of dataParts) scan(p.type, p.data as any);

    if (latestGraphNodes) {
      return (latestGraphNodes as any[]).map((n) => ({
        id: n.id,
        title: n.title,
        status: n.status,
        priority: n.priority,
      }));
    }
    return Array.from(updateMap.values());
  }, [messages, dataParts]);

  // Collect artifacts from persisted message parts AND the live stream. Keyed
  // by id, latest version wins; insertion order = creation order. Feeds the
  // canvas panel and the inline artifact cards.
  const artifacts = useMemo<ArtifactData[]>(() => {
    const map = new Map<string, ArtifactData>();
    const ingest = (type?: string, data?: any) => {
      if (type !== 'data-artifact' || !data?.id) return;
      const prev = map.get(data.id);
      if (!prev || (data.version ?? 0) >= (prev.version ?? 0)) {
        map.set(data.id, data as ArtifactData);
      }
    };
    for (const m of messages as any[]) {
      for (const p of (m?.parts ?? [])) ingest(p?.type, p?.data);
    }
    for (const p of dataParts) ingest(p.type, p.data as any);
    return Array.from(map.values());
  }, [messages, dataParts]);

  // The artifact currently being *written* by the model. The tool's arguments
  // (title/kind/content) stream in as `tool-create_artifact` / `tool-update_artifact`
  // input deltas BEFORE the tool executes, so we can render the source into the
  // canvas live instead of waiting for the finished file. For updates the id
  // matches the existing artifact (content streams over it in place); for
  // creates we use a transient `pending:` id until the real one arrives.
  const streamingArtifact = useMemo<ArtifactData | null>(() => {
    const KINDS = ['html', 'markdown', 'mermaid', 'chart'];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as any;
      if (m?.role !== 'assistant') continue;
      const parts = m.parts ?? [];
      for (let j = parts.length - 1; j >= 0; j--) {
        const p = parts[j];
        const isArtifactTool = p?.type === 'tool-create_artifact' || p?.type === 'tool-update_artifact';
        if (!isArtifactTool) continue;
        // Most recent artifact tool call: only a live one (not yet executed) streams.
        if (p.state !== 'input-streaming' && p.state !== 'input-available') return null;
        const input = (p.input ?? {}) as { id?: string; title?: string; kind?: string; content?: string };
        const content = typeof input.content === 'string' ? input.content : '';
        if (!content && !input.title) return null; // nothing meaningful yet
        const isUpdate = p.type === 'tool-update_artifact';
        const id = isUpdate && input.id ? input.id : `pending:${p.toolCallId}`;
        const kind = (KINDS.includes(input.kind ?? '') ? input.kind : 'markdown') as ArtifactData['kind'];
        return { id, title: input.title ?? 'Untitled', kind, content, version: 0, status: 'streaming' };
      }
    }
    return null;
  }, [messages]);

  // What the panel shows: completed artifacts, with the in-flight one merged in
  // (overriding the same id on an update, appended on a create).
  const panelArtifacts = useMemo<ArtifactData[]>(() => {
    if (!streamingArtifact) return artifacts;
    const map = new Map(artifacts.map((a) => [a.id, a] as const));
    map.set(streamingArtifact.id, streamingArtifact);
    return Array.from(map.values());
  }, [artifacts, streamingArtifact]);

  // A signature of "what artifacts exist + their versions" (the in-flight one
  // counts as v0, stable as its content grows, so we open the canvas ONCE when
  // it appears). When it changes — new artifact, edit, or stream start — open
  // the newest. We *adopt* a loaded session's existing artifacts silently so
  // reopening a chat doesn't fling the panel open. (ChatArea is keyed by
  // session, so this ref resets per session.)
  const artifactSignature = panelArtifacts.map((a) => `${a.id}@${a.version}`).join('|');
  const prevSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSignatureRef.current === null) {
      // First settled state: record it without opening (skip while still loading).
      if (!isLoadingHistory) prevSignatureRef.current = artifactSignature;
      return;
    }
    if (artifactSignature && artifactSignature !== prevSignatureRef.current) {
      const newest = panelArtifacts[panelArtifacts.length - 1];
      if (newest) {
        setActiveArtifactId(newest.id);
        setPanelOpen(true);
      }
    }
    prevSignatureRef.current = artifactSignature;
  }, [artifactSignature, isLoadingHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  const openArtifact = useCallback((id: string) => {
    setActiveArtifactId(id);
    setPanelOpen(true);
  }, []);

  // Deployed sub-agents, derived from the live delegation stream. Each becomes a
  // tab above the composer so its own work can be viewed in isolation.
  const agents = useMemo<AgentTabInfo[]>(() => {
    const toStatus = (s?: string): AgentTabInfo['status'] =>
      s === 'complete' ? 'complete' : s === 'failed' ? 'failed' : 'active';
    const subs = new Map<string, AgentTabInfo>();
    for (const p of dataParts) {
      const d = p.data as any;
      if (p.type === 'data-delegation' && d?.delegationId) {
        subs.set(d.delegationId, { id: d.delegationId, name: d.agentName ?? 'Sub-agent', status: toStatus(d.status), task: d.task });
      }
    }
    // Fallback: a sub-agent that streamed work before its delegation card.
    for (const p of dataParts) {
      const d = p.data as any;
      if (p.type !== 'data-delegation' && d?.delegationId && !subs.has(d.delegationId)) {
        subs.set(d.delegationId, { id: d.delegationId, name: d.agentName ?? 'Sub-agent', status: 'active' });
      }
    }
    return [{ id: 'main', name: 'Main agent', status: 'active' }, ...subs.values()];
  }, [dataParts]);

  // Fall back to main if the selected agent is gone (e.g. the turn ended).
  const effectiveAgent = agents.some((a) => a.id === activeAgent) ? activeAgent : 'main';
  const viewingMain = effectiveAgent === 'main';
  const activeSubAgent = viewingMain ? undefined : agents.find((a) => a.id === effectiveAgent);

  // Which agent a live part belongs to: a delegation card is the MAIN agent's
  // orchestration; anything else carrying a delegationId is the sub-agent's own
  // work; everything else is the main agent.
  const partAgentId = (p: LiveDataPart): string => {
    if (p.type === 'data-delegation') return 'main';
    const d = p.data as { delegationId?: string } | undefined;
    return d?.delegationId ?? 'main';
  };
  const visibleParts = useMemo(
    () => dataParts.filter((p) => partAgentId(p) === effectiveAgent),
    [dataParts, effectiveAgent],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      setDataParts([]); // Clear previous data parts
      setActiveAgent('main'); // new turn starts on the main agent's view
      sendMessage({ text: input });
      setInput('');
    }
  };

  // The in-flight assistant turn must render its live activity rail (the
  // PROCESS) *above* its streamed answer (the TEXT) so the turn reads top to
  // bottom in the order it happened. We peel the active assistant message out
  // of the normal list and re-render it after the activity block — otherwise
  // the answer pops into `messages.map` above the rail that produced it.
  const lastMessage = messages[messages.length - 1];
  const activeAssistant =
    !isLoadingHistory &&
    lastMessage?.role === 'assistant' &&
    (isLoading || dataParts.length > 0)
      ? lastMessage
      : undefined;
  const displayMessages = activeAssistant ? messages.slice(0, -1) : messages;
  // Has the active turn produced conversational text/reasoning yet? (Tool work
  // lives in the activity rail, so it doesn't count as a visible "answer".)
  const hasAnswerContent = (m: any) =>
    (m?.parts ?? []).some(
      (p: any) =>
        (p?.type === 'text' && p.text) ||
        ((p?.type === 'reasoning' || p?.type === 'thinking') && p.text),
    );
  const answerReady = !!activeAssistant && hasAnswerContent(activeAssistant);

  return (
    <ArtifactsContext.Provider value={{ open: openArtifact, activeId: activeArtifactId }}>
    <div className="flex h-full overflow-hidden">
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {/* The main conversation only renders on the Main agent tab — a
              sub-agent tab is an isolated view of just that agent's work. */}
          {viewingMain && (isLoadingHistory ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-5 h-5 text-zinc-400 dark:text-zinc-600 animate-spin mr-2" />
              <span className="text-sm text-zinc-600 dark:text-zinc-500">Loading...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="relative mx-auto flex h-full max-w-2xl flex-col justify-end gap-12 px-2 pb-14 pt-24">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
                  /sessions/{sessionId.slice(0, 12)}
                </p>
                <h2 className="mt-4 font-display text-[64px] leading-[0.95] text-[color:var(--color-ink)]">
                  what would you<br />like to <span className="text-[color:var(--color-amber)]">build</span>?
                </h2>
                <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[color:var(--color-ink-soft)]">
                  An agent harness with planning, reflexion, memory and a roster
                  of specialists. Describe a goal — files, code, browser, the lot.
                </p>
              </div>
              <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-[color:var(--color-line-strong)] bg-[color:var(--color-line-strong)] sm:grid-cols-2">
                {[
                  { tag: 'audit', text: 'Walk this repo and tell me what to fix first.' },
                  { tag: 'build', text: 'Scaffold a Hono + Bun API with auth.' },
                  { tag: 'research', text: 'Compare three vector DBs for our use case.' },
                  { tag: 'fix', text: 'Find every `as any` in src/ and propose typed alternatives.' },
                ].map((seed) => (
                  <li key={seed.text}>
                    <button
                      type="button"
                      onClick={() => setInput(seed.text)}
                      className="group flex h-full w-full flex-col items-start gap-2 bg-[color:var(--color-ground)] px-4 py-3 text-left transition-colors hover:bg-[color:var(--color-surface)]"
                    >
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-amber)]">
                        {seed.tag}
                      </span>
                      <span className="text-[13.5px] leading-snug text-[color:var(--color-ink-soft)] group-hover:text-[color:var(--color-ink)]">
                        {seed.text}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
                <span className="h-px flex-1 bg-[color:var(--color-line)]" />
                <span>{['planning', 'reflexion', 'memory', 'swarm', 'sub-agents'].join(' · ')}</span>
                <span className="h-px flex-1 bg-[color:var(--color-line)]" />
              </div>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {displayMessages.map((message) => {
                // Pre-filter messages: skip assistant messages with no parts or empty parts
                const parts = message.parts || [];
                const isUser = message.role === 'user';

                if (!isUser && parts.length === 0) {
                  return null;
                }

                // Check if any part has actual content
                const hasActualContent = parts.some((part: any) => {
                  // Text with content
                  if (part.type === 'text' && part.text) return true;
                  // Reasoning with content
                  if ((part.type === 'reasoning' || part.type === 'thinking') && part.text) return true;
                  // Data parts
                  if (part.type?.startsWith('data-')) return true;
                  // Tool approvals with id
                  if (part.approval?.id) return true;
                  // Completed tool parts
                  if ((part.type?.startsWith('tool-') || part.type === 'dynamic-tool') &&
                      ['output-available', 'output-error', 'output-denied'].includes(part.state)) {
                    return true;
                  }
                  return false;
                });

                if (!isUser && !hasActualContent) {
                  return null;
                }

                return (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    onApprove={(id) => addToolApprovalResponse({ id, approved: true, reason: 'Approved' })}
                    onDeny={(id) => addToolApprovalResponse({ id, approved: false, reason: 'user denied' })}
                  />
                );
              })}
            </AnimatePresence>
          ))}

          {/* Isolated sub-agent view: a header naming the agent + its task. */}
          {!viewingMain && activeSubAgent && (
            <div className="mb-3 rounded-xl border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-amber)]">
                  sub-agent
                </span>
                <span className="text-[14px] font-medium text-[color:var(--color-ink)]">{activeSubAgent.name}</span>
                <span
                  className={cn(
                    'font-mono text-[10px] uppercase tracking-[0.14em]',
                    activeSubAgent.status === 'complete'
                      ? 'text-[color:var(--color-moss)]'
                      : activeSubAgent.status === 'failed'
                        ? 'text-[color:var(--color-ember)]'
                        : 'text-[color:var(--color-amber)]',
                  )}
                >
                  {activeSubAgent.status === 'complete' ? 'done' : activeSubAgent.status === 'failed' ? 'failed' : 'working'}
                </span>
              </div>
              {activeSubAgent.task && (
                <p className="mt-1.5 text-[13px] leading-relaxed text-[color:var(--color-ink-soft)]">{activeSubAgent.task}</p>
              )}
            </div>
          )}

          {/* Streaming data parts — tool runs collapse into a single
              activity rail (one row per operationId) so the chat doesn't
              fill with `bash complete` cards. Other live parts (errors,
              task updates, summaries, …) render through the legacy path. */}
          {visibleParts.length > 0 && (
            <div className="flex items-start gap-3 py-3">
              <Avatar type="bot" size="md" />
              <div className="flex-1 space-y-3">
                <StatusStrip parts={visibleParts} />
                <ActivityStream parts={visibleParts} />
                {visibleParts.some(p => !SUPPRESSED_CHAT_PARTS.has(p.type)) && (
                  <div className="space-y-2">
                    <AnimatePresence mode="popLayout">
                      {visibleParts
                        .filter(p => !SUPPRESSED_CHAT_PARTS.has(p.type))
                        .map((part) => (
                          <motion.div
                            key={part.key}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.2 }}
                          >
                            <DataPartRenderer part={part} />
                          </motion.div>
                        ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sub-agent tab with nothing streamed yet. */}
          {!viewingMain && visibleParts.length === 0 && (
            <div className="py-10 text-center font-mono text-[12px] text-[color:var(--color-ink-faint)]">
              Waiting for {activeSubAgent?.name ?? 'the sub-agent'}…
            </div>
          )}

          {/* The in-flight assistant answer, rendered AFTER its activity rail so
              the turn reads process → answer instead of answer-on-top. `live`
              keeps it to text/reasoning — the rail above owns the tool log. */}
          {viewingMain && answerReady && (
            <ChatMessage
              key={activeAssistant!.id}
              message={activeAssistant}
              live
              onApprove={(id) => addToolApprovalResponse({ id, approved: true, reason: 'Approved' })}
              onDeny={(id) => addToolApprovalResponse({ id, approved: false, reason: 'user denied' })}
            />
          )}

          {/* Thinking indicator — only at the very start, before the rail or any
              answer has appeared (otherwise the rail already signals progress). */}
          {viewingMain && isLoading && !isLoadingHistory && messages.length > 0 &&
            !answerReady && dataParts.length === 0 && (
            <TypingIndicator />
          )}

          {/* Error — soft, inline. The provider can return errors mid-loop
              (rate limits on free tiers, transient upstream failures, …);
              treat them as a status note, not a screen-of-doom card. */}
          {error && (
            <div className="mt-4 flex items-start gap-3 border-l-2 border-[color:var(--color-ember)] pl-3 font-mono text-[12px] leading-relaxed text-[color:var(--color-ink-soft)]">
              <span className="mt-[2px] text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ember)]">
                error
              </span>
              <span className="flex-1 break-words">
                {error.message || 'provider returned an error — try again, or pick a different model'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 px-4 pb-5 pt-3">
        <AgentTabs agents={agents} active={effectiveAgent} onSelect={setActiveAgent} />
        <TaskChecklist tasks={tasks} />
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
          <div className="rounded-2xl border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] px-3.5 pt-3 pb-2 transition-all focus-within:border-[color:var(--color-amber)]/70 focus-within:shadow-[0_0_0_3px_rgba(240,184,108,0.08)]">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe a goal — Vibes plans, codes, and runs it."
              autoResize
              maxLength={5000}
              className="block w-full min-h-[76px] px-0 py-0 text-[15px] leading-relaxed text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-faint)]"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              {/* session token usage + estimated cost */}
              <div
                className="flex items-center gap-1.5 font-mono text-[11px] text-[color:var(--color-ink-faint)]"
                title="Session tokens · estimated cost"
              >
                <Coins className="h-3.5 w-3.5" />
                <span className="text-[color:var(--color-ink-soft)]">{formatTokens(usage?.totalTokens ?? 0)}</span>
                <span>tok</span>
                <span className="opacity-40">·</span>
                <span>{estimateCost(usage, models.find((m) => m.id === model))}</span>
              </div>

              {/* model selector + send */}
              <div className="flex items-center gap-2">
                <ModelSelector models={models} value={model ?? ''} onChange={onModelChange} placement="top" />
                <button
                  type={isLoading ? 'button' : 'submit'}
                  onClick={isLoading ? () => stop?.() : undefined}
                  disabled={!isLoading && !input.trim()}
                  aria-label={isLoading ? 'Stop generating' : 'Send message'}
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-150',
                    isLoading
                      ? 'bg-[color:var(--color-ember)] text-[color:var(--color-ground)] hover:opacity-90'
                      : input.trim()
                        ? 'scale-100 bg-[color:var(--color-amber)] text-[color:var(--color-ground)] shadow-sm hover:opacity-90'
                        : 'scale-95 cursor-not-allowed bg-[rgba(244,238,228,0.06)] text-[color:var(--color-ink-faint)]'
                  )}
                >
                  {isLoading ? <Square className="h-3.5 w-3.5" /> : <ArrowUp className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
    <AnimatePresence>
      {panelOpen && panelArtifacts.length > 0 && (
        <ArtifactPanel
          artifacts={panelArtifacts}
          activeId={activeArtifactId}
          onSelect={setActiveArtifactId}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </AnimatePresence>
    </div>
    </ArtifactsContext.Provider>
  );
};

// ============ MAIN APP ============
export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    return localStorage.getItem('vibes_session_id') || 'default';
  });
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem('vibes_sidebar_open');
    if (saved !== null) return saved === '1';
    return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
  });
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(() => localStorage.getItem('vibes_model') || '');

  const fetchSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (data.success) {
        setSessions(data.sessions);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  const createSession = useCallback(async (title?: string) => {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(title ? { title } : {}),
      });
      const data = await res.json();
      if (data.success) {
        await fetchSessions();
        setCurrentSessionId(data.sessionId);
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, [fetchSessions]);

  const deleteSession = useCallback(async (sessionId: string) => {
    if (sessionId === 'default') return;
    try {
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      await fetchSessions();
      if (currentSessionId === sessionId) {
        setCurrentSessionId('default');
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }, [currentSessionId, fetchSessions]);

  useEffect(() => {
    localStorage.setItem('vibes_session_id', currentSessionId);
  }, [currentSessionId]);

  useEffect(() => {
    localStorage.setItem('vibes_sidebar_open', sidebarOpen ? '1' : '0');
  }, [sidebarOpen]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Load available models and resolve the active selection.
  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((d) => {
        if (!d?.success) return;
        setModels(d.models ?? []);
        setSelectedModel((prev) => prev || d.active || d.models?.[0]?.id || '');
      })
      .catch(() => { /* selector stays hidden if unavailable */ });
  }, []);

  useEffect(() => {
    if (selectedModel) localStorage.setItem('vibes_model', selectedModel);
  }, [selectedModel]);

  const currentSession = sessions.find(s => s.id === currentSessionId);

  return (
    <div className="flex h-screen bg-[color:var(--color-ground)] text-[color:var(--color-ink)] bg-paper-grain">
      {/* Session Sidebar (wider + collapsible) */}
      <AnimatePresence>
        {sidebarOpen && (
          <SessionSidebar
            sessions={sessions}
            currentSessionId={currentSessionId}
            isLoading={isLoadingSessions}
            onSessionSelect={setCurrentSessionId}
            onCreate={createSession}
            onDeleteSession={deleteSession}
            onClose={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-[color:var(--color-line)] bg-[color:var(--color-ground)] px-5 py-3">
          <div className="flex items-center gap-4">
            <IconButton
              icon={<PanelLeft className="w-5 h-5 text-[color:var(--color-ink-soft)]" />}
              label={sidebarOpen ? 'Hide sessions' : 'Show sessions'}
              onClick={() => setSidebarOpen((v) => !v)}
            />

            <div className="flex items-baseline gap-3">
              <h1 className="font-display text-[26px] leading-none text-[color:var(--color-ink)]">
                Vibes
              </h1>
              <span className="h-3 w-px bg-[color:var(--color-line-strong)]" aria-hidden />
              <p className="max-w-[220px] truncate font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
                {currentSession?.metadata?.title || currentSessionId}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {sessions.length > 1 && (
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
                {sessions.length} sessions
              </span>
            )}
          </div>
        </header>

        {/* Chat Area */}
        <ChatArea
          key={currentSessionId}
          sessionId={currentSessionId}
          model={selectedModel}
          models={models}
          onModelChange={setSelectedModel}
          usage={currentSession?.metadata?.usage}
          onSessionUpdate={fetchSessions}
        />
      </div>
    </div>
  );
}
