import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai';
import {
  Bot,
  Check,
  Database,
  History,
  Loader2,
  Menu,
  MessageSquare,
  Moon,
  PencilLine,
  Plus,
  Send,
  Shield,
  Sparkles,
  Square,
  SunMedium,
  Trash2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from './lib/utils';
import { DataPartRenderer, isDataPart } from './components/data-parts';
import { TextPart, ReasoningPart, ToolResultPart } from './components/message-parts';
import { Button } from './components/ui/Button';
import { Textarea } from './components/ui/Input';
import { Card } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import { Avatar } from './components/ui/Avatar';
import { ChatBubble } from './components/chat/ChatBubble';
import { TypingIndicator } from './components/chat/TypingIndicator';

const SESSION_STORAGE_KEY = 'vibes.active-session';
const THEME_STORAGE_KEY = 'vibes.theme';
const UNTITLED_SESSION = 'Untitled session';
const STARTER_PROMPTS = [
  'Plan a feature, then implement it step by step.',
  'Audit this codebase for risky session handling paths.',
  'Design a landing page and build the components.',
  'Trace a production bug and propose the smallest safe fix.',
];

interface SessionRecord {
  id: string;
  summary?: string;
  metadata?: {
    title?: string;
    workspaceDir?: string;
    [key: string]: unknown;
  };
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
}

interface LiveDataPart {
  key: string;
  type: string;
  data: unknown;
}

interface ApprovalCardProps {
  toolName: string;
  args: unknown;
  approvalId: string;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

type Theme = 'light' | 'dark';

function getInitialTheme(): Theme {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme;
  }

  return 'dark';
}

function deriveSessionTitle(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return UNTITLED_SESSION;
  }

  return compact.length > 48 ? `${compact.slice(0, 47).trimEnd()}…` : compact;
}

function getSessionTitle(session?: SessionRecord | null): string {
  return session?.metadata?.title || UNTITLED_SESSION;
}

function isPlaceholderTitle(title?: string): boolean {
  return !title || title === UNTITLED_SESSION;
}

function formatRelativeTime(value?: string): string {
  if (!value) {
    return 'Just now';
  }

  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 1) {
    return 'Just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function pickSessionId(sessions: SessionRecord[], preferredId?: string | null): string | null {
  if (preferredId && sessions.some((session) => session.id === preferredId)) {
    return preferredId;
  }

  return sessions[0]?.id ?? null;
}

function ApprovalCard({ toolName, args, approvalId, onApprove, onDeny }: ApprovalCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const formattedArgs = JSON.stringify(args, null, 2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="overflow-hidden rounded-[1.15rem] border border-amber-500/20 bg-amber-500/8 shadow-[0_16px_40px_rgba(217,119,6,0.12)]"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setIsExpanded((value) => !value)}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/14 text-amber-500">
            <Shield className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--ink)]">Permission required</p>
            <p className="text-xs text-[var(--muted)]">{toolName}</p>
          </div>
        </div>
        <Badge variant="amber" size="sm">
          Awaiting input
        </Badge>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-amber-200/70 px-4 py-4">
              <pre className="max-h-56 overflow-auto rounded-2xl bg-[var(--ink-strong)]/95 px-4 py-3 font-mono text-xs text-white/80">
                {formattedArgs}
              </pre>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1 !rounded-full border border-[var(--line)] bg-[var(--surface-raised)] text-[var(--ink)]"
                  onClick={() => onDeny(approvalId)}
                >
                  Deny
                </Button>
                <Button
                  variant="primary"
                  className="flex-1 !rounded-full bg-[var(--accent)] text-white hover:bg-[var(--accent-strong)]"
                  onClick={() => onApprove(approvalId)}
                >
                  Approve
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SessionListItem({
  session,
  isActive,
  onSelect,
  onDelete,
}: {
  session: SessionRecord;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        'group relative overflow-hidden rounded-[1.1rem] border transition-all duration-200',
        isActive
          ? 'border-[var(--line)] bg-[var(--sidebar-surface-strong)]'
          : 'border-transparent bg-transparent hover:border-[var(--line)] hover:bg-[var(--sidebar-surface)]',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full px-4 py-3 text-left"
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border',
              isActive
                ? 'border-[var(--line)] bg-[var(--accent-soft)] text-[var(--accent-strong)]'
                : 'border-[var(--line)] bg-[var(--surface-raised)] text-[var(--sidebar-muted)]',
            )}
          >
            <MessageSquare className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-semibold text-[var(--sidebar-ink)]">
                {getSessionTitle(session)}
              </p>
              <span className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-[var(--sidebar-muted)]">
                {formatRelativeTime(session.updatedAt || session.createdAt)}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-[var(--sidebar-muted)]">
              <span>{session.messageCount ?? 0} messages</span>
              {session.summary ? (
                <>
                  <span className="h-1 w-1 rounded-full bg-[var(--line-strong)]" />
                  <span className="truncate">{session.summary}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={onDelete}
        className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-[var(--sidebar-muted)] opacity-0 transition hover:bg-red-500/12 hover:text-[var(--danger)] group-hover:opacity-100"
        aria-label="Delete session"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

function ChatMessage({
  message,
  onApprove,
  onDeny,
}: {
  message: any;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const isUser = message.role === 'user';
  const parts = message.parts || [];
  const seenToolApprovals = new Set<string>();
  const seenToolResults = new Set<string>();
  let hasComplexContent = false;

  const renderedParts = parts.map((part: any, partIndex: number) => {
    if (part.type === 'text' && part.text) {
      return <TextPart key={`text-${partIndex}`} text={part.text} isUser={isUser} />;
    }

    if ((part.type === 'reasoning' || part.type === 'thinking') && part.text) {
      hasComplexContent = true;
      return <ReasoningPart key={`reasoning-${partIndex}`} text={part.text} />;
    }

    if (isDataPart(part)) {
      hasComplexContent = true;
      return <DataPartRenderer key={`data-${partIndex}`} part={part} />;
    }

    if (part.type === 'data' && isDataPart(part.data)) {
      hasComplexContent = true;
      return <DataPartRenderer key={`wrapped-data-${partIndex}`} part={part.data} />;
    }

    const needsApproval =
      part.state === 'call' ||
      part.state === 'approval-requested' ||
      part.state === 'input-available';
    if (needsApproval && part.toolCallId && !seenToolApprovals.has(part.toolCallId) && part.approval?.id) {
      seenToolApprovals.add(part.toolCallId);
      hasComplexContent = true;
      return (
        <ApprovalCard
          key={`approval-${part.toolCallId}`}
          toolName={part.toolName || part.name || 'Unknown tool'}
          args={part.args || part.input || {}}
          approvalId={part.approval.id}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      );
    }

    const isToolPart = part.type?.startsWith('tool-') || part.type === 'dynamic-tool';
    const isComplete = ['output-available', 'output-error', 'output-denied'].includes(part.state);
    if (isToolPart && isComplete && part.toolCallId && !seenToolResults.has(part.toolCallId)) {
      seenToolResults.add(part.toolCallId);
      hasComplexContent = true;
      return (
        <ToolResultPart
          key={`tool-result-${part.toolCallId}`}
          toolName={part.toolName || part.name || 'tool'}
          isError={part.state === 'output-error' || part.state === 'output-denied'}
        />
      );
    }

    return null;
  }).filter(Boolean);

  if (!isUser && renderedParts.length === 0) {
    return null;
  }

  if (!hasComplexContent) {
    return (
      <ChatBubble role={isUser ? 'user' : 'assistant'}>
        <div className="space-y-3">{renderedParts}</div>
      </ChatBubble>
    );
  }

  return (
    <div className={cn('mb-7 flex gap-4', isUser && 'flex-row-reverse')}>
      <Avatar type={isUser ? 'user' : 'bot'} size="md" />
      <div
        className={cn(
          'min-w-0 flex flex-1 flex-col gap-2',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        {renderedParts}
      </div>
    </div>
  );
}

function LandingStage({
  input,
  isCreatingSession,
  onInputChange,
  onStartPrompt,
  onCreateBlank,
}: {
  input: string;
  isCreatingSession: boolean;
  onInputChange: (value: string) => void;
  onStartPrompt: (prompt: string) => void;
  onCreateBlank: () => void;
}) {
  return (
    <div className="flex h-full items-center px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="order-2 space-y-5 lg:order-1 lg:pr-6"
        >
          <Badge
            variant="zinc"
            size="sm"
            className="!rounded-full !border !border-[var(--line)] !bg-[color:color-mix(in_srgb,var(--surface)_82%,transparent)] !px-3 !py-1 !text-[10px] uppercase tracking-[0.22em] !text-[var(--muted)]"
          >
            Persistent sessions
          </Badge>
          <div className="space-y-4">
            <h1 className="max-w-xl font-['Playfair_Display'] text-4xl leading-[0.96] text-[var(--ink)] sm:text-5xl lg:text-[3.85rem]">
              Start fast, keep context, come back to the exact same workspace later.
            </h1>
            <p className="max-w-xl text-[15px] leading-7 text-[var(--muted)] sm:text-base">
              The first message creates a real session, stores every reply, and keeps the workspace attached to that chat.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1.35rem] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface)_82%,transparent)] p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">Memory</p>
              <p className="mt-2 text-sm leading-6 text-[var(--ink)]">Session history survives refreshes, restarts, and switching chats.</p>
            </div>
            <div className="rounded-[1.35rem] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface)_82%,transparent)] p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">Workspace</p>
              <p className="mt-2 text-sm leading-6 text-[var(--ink)]">Each thread gets its own workspace and stored metadata.</p>
            </div>
            <div className="rounded-[1.35rem] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface)_82%,transparent)] p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">Trace</p>
              <p className="mt-2 text-sm leading-6 text-[var(--ink)]">Tool calls, reasoning, and updates stream live while the answer builds.</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="order-1 overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface-strong)_88%,transparent)] p-4 backdrop-blur-xl xl:p-5"
        >
          <div className="rounded-[1.65rem] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface)_92%,transparent)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onStartPrompt(input);
              }}
              className="flex flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-3 px-2 pt-1">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">New session</p>
                  <p className="mt-1 text-sm text-[var(--ink)]">Start with a prompt or open a blank workspace.</p>
                </div>
                <Badge variant="cyan" size="sm" className="!rounded-full !px-3 !py-1">
                  Session-backed
                </Badge>
              </div>

              <Textarea
                value={input}
                onChange={(event) => onInputChange(event.target.value)}
                placeholder="Ask Vibes to debug, implement, review, or plan."
                autoResize
                maxLength={4000}
                className="min-h-[130px] px-4 py-4 text-[15px]"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    onStartPrompt(input);
                  }
                }}
              />

              <div className="grid gap-2 sm:grid-cols-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="rounded-[1.15rem] border border-[var(--line)] bg-[var(--surface-raised)] px-4 py-3 text-left text-sm leading-6 text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-strong)]"
                    onClick={() => onStartPrompt(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-3 border-t border-[var(--line)] px-2 pt-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs leading-6 text-[var(--muted)]">
                  The opening prompt becomes the session title and message history starts immediately.
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="!rounded-full border border-[var(--line)] bg-[var(--surface-raised)] text-[var(--ink)]"
                    onClick={onCreateBlank}
                    disabled={isCreatingSession}
                  >
                    <Plus className="h-4 w-4" />
                    Blank session
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    className="!rounded-full bg-[var(--accent)] px-5 text-white hover:bg-[var(--accent-strong)]"
                    disabled={!input.trim() || isCreatingSession}
                    isLoading={isCreatingSession}
                  >
                    <Sparkles className="h-4 w-4" />
                    Start
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function ActivityRail({
  liveDataParts,
  isBusy,
}: {
  liveDataParts: LiveDataPart[];
  isBusy: boolean;
}) {
  if (!isBusy && liveDataParts.length === 0) {
    return null;
  }

  return (
    <aside className="hidden w-[296px] shrink-0 border-l border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface)_64%,transparent)] px-4 py-4 xl:flex">
      <Card className="flex min-h-0 flex-1 flex-col rounded-[1.45rem] border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface-strong)_90%,transparent)] p-4">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-1 pb-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Live trace</p>
            <p className="mt-1 text-sm text-[var(--ink)]">
              Agent activity, tool progress, and streamed state.
            </p>
          </div>
          <Badge
            variant="zinc"
            size="sm"
            className="!rounded-full !bg-[var(--surface)] !text-[var(--muted)]"
          >
            {isBusy ? 'Live' : liveDataParts.length}
          </Badge>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pt-4 pr-1">
          {liveDataParts.length > 0 ? (
            liveDataParts.slice(-8).map((part) => (
              <div
                key={part.key}
                className="rounded-[1.15rem] border border-[var(--line)] bg-[var(--surface)] p-3"
              >
                <DataPartRenderer part={part} />
              </div>
            ))
          ) : (
            <div className="rounded-[1.2rem] border border-dashed border-[var(--line)] bg-[var(--surface)] px-4 py-5 text-sm leading-6 text-[var(--muted)]">
              Waiting for the first streamed trace event.
            </div>
          )}
        </div>
      </Card>
    </aside>
  );
}

function ConversationPane({
  session,
  initialPrompt,
  onInitialPromptConsumed,
  onSessionRefresh,
  onSessionTitleSuggest,
}: {
  session: SessionRecord;
  initialPrompt?: string | null;
  onInitialPromptConsumed: () => void;
  onSessionRefresh: () => void;
  onSessionTitleSuggest: (title: string) => void;
}) {
  const [input, setInput] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [dataParts, setDataParts] = useState<LiveDataPart[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const hasConsumedInitialPrompt = useRef<string | null>(null);
  const previousStatusRef = useRef<string>('ready');

  const {
    messages,
    sendMessage,
    status,
    addToolApprovalResponse,
    error,
    stop,
    setMessages,
  } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/mimo-code/stream',
      headers: { 'Content-Type': 'application/json' },
      body: { session_id: session.id },
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onData: (dataPart: any) => {
      const { type, data } = dataPart;
      const stableId = typeof dataPart.id === 'string' ? `${type}:${dataPart.id}` : undefined;

      setDataParts((current) => {
        const nextPart: LiveDataPart = {
          key: stableId || `${type}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          type,
          data,
        };

        if (!stableId) {
          return [...current, nextPart];
        }

        const next = [...current];
        const existingIndex = next.findIndex((part) => part.key === stableId);

        if (existingIndex === -1) {
          next.push(nextPart);
        } else {
          next[existingIndex] = nextPart;
        }

        return next;
      });
    },
  });

  const submitPrompt = useCallback((prompt: string) => {
    const content = prompt.trim();
    if (!content) {
      return;
    }

    const userMessages = messages.filter((message) => message.role === 'user');
    if (userMessages.length === 0 && isPlaceholderTitle(session.metadata?.title)) {
      onSessionTitleSuggest(deriveSessionTitle(content));
    }

    setDataParts([]);
    sendMessage({ text: content });
    setInput('');
  }, [messages, onSessionTitleSuggest, sendMessage, session.metadata?.title]);

  useEffect(() => {
    let cancelled = false;

    const fetchHistory = async () => {
      setIsLoadingHistory(true);
      setDataParts([]);

      try {
        const response = await fetch(`/api/sessions/${session.id}/messages`);
        const payload = await response.json();

        if (!cancelled) {
          const nextMessages = payload.success ? (payload.messages || []) : [];
          setMessages(nextMessages.map((message: any) => ({
            id: message.id,
            role: message.role,
            parts: message.parts || [],
          })));
        }
      } catch (fetchError) {
        if (!cancelled) {
          console.error('Failed to fetch session history:', fetchError);
          setMessages([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    };

    hasConsumedInitialPrompt.current = null;
    fetchHistory();

    return () => {
      cancelled = true;
    };
  }, [session.id, setMessages]);

  useEffect(() => {
    if (!initialPrompt || isLoadingHistory) {
      return;
    }

    if (messages.length > 0) {
      onInitialPromptConsumed();
      return;
    }

    if (hasConsumedInitialPrompt.current === initialPrompt) {
      return;
    }

    hasConsumedInitialPrompt.current = initialPrompt;
    submitPrompt(initialPrompt);
    onInitialPromptConsumed();
  }, [initialPrompt, isLoadingHistory, messages.length, onInitialPromptConsumed, submitPrompt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: status === 'streaming' ? 'smooth' : 'auto',
      block: 'end',
    });
  }, [messages, dataParts, status]);

  useEffect(() => {
    const previous = previousStatusRef.current;
    const finishedStreaming =
      (previous === 'streaming' || previous === 'submitted') && status === 'ready';

    if (!isLoadingHistory && finishedStreaming) {
      onSessionRefresh();
      const timeoutId = window.setTimeout(() => {
        setDataParts([]);
      }, 1800);

      previousStatusRef.current = status;
      return () => window.clearTimeout(timeoutId);
    }

    previousStatusRef.current = status;
    return undefined;
  }, [isLoadingHistory, onSessionRefresh, status]);

  const isBusy = status === 'streaming' || status === 'submitted';

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-4 sm:px-6 lg:px-8">
          <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-6 pb-4">
            {isLoadingHistory ? (
              <div className="flex min-h-[40vh] items-center justify-center">
                <div className="flex items-center gap-3 rounded-full border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface)_84%,transparent)] px-5 py-3 text-sm text-[var(--muted)] backdrop-blur-md">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading session history
                </div>
              </div>
            ) : messages.length === 0 ? (
              <Card className="overflow-hidden rounded-[1.8rem] border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface-strong)_88%,transparent)] p-7">
                <div className="flex items-start gap-4">
                  <Avatar
                    type="custom"
                    size="lg"
                    icon={<Bot className="h-5 w-5 text-[var(--accent-strong)]" />}
                    className="border border-[var(--accent-soft)] bg-[var(--accent-soft)]"
                  />
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Session ready</p>
                    <h2 className="mt-2 font-['Playfair_Display'] text-4xl leading-none text-[var(--ink)]">
                      {getSessionTitle(session)}
                    </h2>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">
                      This workspace is empty for now. Ask Vibes to inspect the repo, make a plan,
                      or start implementing. The full conversation will be stored back into this session.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {STARTER_PROMPTS.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-raised)]"
                          onClick={() => submitPrompt(prompt)}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            ) : (
              <AnimatePresence initial={false} mode="popLayout">
                {messages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    onApprove={(id) => addToolApprovalResponse({ id, approved: true, reason: 'Approved from UI' })}
                    onDeny={(id) => addToolApprovalResponse({ id, approved: false, reason: 'Denied from UI' })}
                  />
                ))}
              </AnimatePresence>
            )}

            {isBusy && messages.length > 0 && (
              <TypingIndicator />
            )}

            {dataParts.length > 0 ? (
              <div className="space-y-3 xl:hidden">
                {dataParts.slice(-4).map((part) => (
                  <div key={part.key} className="rounded-[1.2rem] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface-strong)_84%,transparent)] p-3">
                    <DataPartRenderer part={part} />
                  </div>
                ))}
              </div>
            ) : null}

            {error ? (
              <Card className="rounded-[1.35rem] border-red-500/20 bg-red-500/12 p-4 text-sm text-[var(--danger)]">
                {error.message || 'An unexpected error interrupted the stream.'}
              </Card>
            ) : null}

            <div ref={bottomRef} />
          </div>
        </div>

        <div className="shrink-0 px-3 pb-3 pt-2 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl">
            <div className="rounded-[1.7rem] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface)_92%,transparent)] p-3 backdrop-blur-xl">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submitPrompt(input);
                }}
                className="flex flex-col gap-3"
              >
                <Textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Message Vibes"
                  autoResize
                  maxLength={5000}
                  className="min-h-[72px] px-4 py-3"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      submitPrompt(input);
                    }
                  }}
                />
                <div className="flex flex-col gap-3 border-t border-[var(--line)] px-2 pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <Database className="h-3.5 w-3.5 text-[var(--accent-strong)]" />
                    Messages persist to the selected session workspace.
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      className="!rounded-full px-4 !text-[var(--muted)] hover:!bg-[var(--surface-raised)] hover:!text-[var(--ink)]"
                      onClick={() => stop?.()}
                      disabled={!isBusy}
                    >
                      <Square className="h-4 w-4" />
                      Stop
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      className="!rounded-full bg-[var(--accent)] px-5 text-white hover:bg-[var(--accent-strong)]"
                      disabled={!input.trim() || isBusy}
                      isLoading={isBusy}
                    >
                      <Send className="h-4 w-4" />
                      Send
                    </Button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      <ActivityRail
        liveDataParts={dataParts}
        isBusy={isBusy}
      />
    </div>
  );
}

export default function App() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [landingInput, setLandingInput] = useState('');
  const [pendingInitialPrompt, setPendingInitialPrompt] = useState<{
    sessionId: string;
    text: string;
  } | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [, startTransition] = useTransition();

  const refreshSessions = useCallback(async (preferredId?: string | null) => {
    setIsLoadingSessions(true);

    try {
      const response = await fetch('/api/sessions');
      const payload = await response.json();

      if (!payload.success) {
        return;
      }

      const nextSessions = payload.sessions as SessionRecord[];
      const storedId = localStorage.getItem(SESSION_STORAGE_KEY);

      startTransition(() => {
        setSessions(nextSessions);
        setCurrentSessionId((current) => pickSessionId(
          nextSessions,
          preferredId ?? current ?? storedId,
        ));
      });
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [startTransition]);

  const createSession = useCallback(async ({
    title,
    seedPrompt,
  }: {
    title?: string;
    seedPrompt?: string;
  } = {}) => {
    setIsCreatingSession(true);

    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(title ? { title } : {}),
      });
      const payload = await response.json();

      if (!payload.success) {
        throw new Error(payload.error || 'Failed to create session');
      }

      const session = (payload.session || {
        id: payload.sessionId as string,
        metadata: title ? { title } : undefined,
      }) as SessionRecord;

      startTransition(() => {
        setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
        setCurrentSessionId(session.id);
        setIsSidebarOpen(false);
        if (seedPrompt) {
          setPendingInitialPrompt({ sessionId: session.id, text: seedPrompt });
        }
      });

      setLandingInput('');
      setIsEditingTitle(false);
      await refreshSessions(session.id);

      return session;
    } finally {
      setIsCreatingSession(false);
    }
  }, [refreshSessions, startTransition]);

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });

      const remaining = sessions.filter((session) => session.id !== sessionId);
      const nextId = pickSessionId(
        remaining,
        currentSessionId === sessionId ? remaining[0]?.id ?? null : currentSessionId,
      );

      startTransition(() => {
        setSessions(remaining);
        setCurrentSessionId(nextId);
      });

      await refreshSessions(nextId);
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }, [currentSessionId, refreshSessions, sessions, startTransition]);

  const updateSessionTitle = useCallback(async (sessionId: string, title: string) => {
    const trimmedTitle = title.trim() || UNTITLED_SESSION;

    startTransition(() => {
      setSessions((current) => current.map((session) => (
        session.id === sessionId
          ? {
              ...session,
              metadata: {
                ...(session.metadata || {}),
                title: trimmedTitle,
              },
            }
          : session
      )));
    });

    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle }),
      });
      await refreshSessions(sessionId);
    } catch (error) {
      console.error('Failed to rename session:', error);
    }
  }, [refreshSessions, startTransition]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem(SESSION_STORAGE_KEY, currentSessionId);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [currentSessionId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const currentSession = sessions.find((session) => session.id === currentSessionId) || null;

  useEffect(() => {
    setIsEditingTitle(false);
    setTitleDraft(getSessionTitle(currentSession));
  }, [currentSessionId, currentSession]);

  return (
    <div className="relative flex h-[100dvh] min-h-[100dvh] overflow-hidden bg-[var(--paper)] text-[var(--ink)]">

      <AnimatePresence>
        {isSidebarOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        ) : null}
      </AnimatePresence>

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[304px] flex-col border-r border-[var(--line)] bg-[color:color-mix(in_srgb,var(--sidebar)_92%,transparent)] text-[var(--sidebar-ink)] backdrop-blur-xl transition-transform duration-300 lg:static lg:z-0 lg:translate-x-0',
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="border-b border-[var(--line)] px-5 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--sidebar-muted)]">Workspace chat</p>
              <h1 className="mt-2 font-['Playfair_Display'] text-4xl leading-none text-[var(--sidebar-ink)]">Vibes</h1>
            </div>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-raised)] text-[var(--sidebar-muted)] transition hover:bg-[var(--sidebar-surface)] hover:text-[var(--sidebar-ink)] lg:hidden"
              onClick={() => setIsSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--sidebar-muted)]">
            Real sessions, stored history, and a dedicated workspace behind every chat.
          </p>
          <Button
            variant="primary"
            className="mt-5 w-full !rounded-full !bg-[var(--accent)] !text-white shadow-[0_0_32px_var(--accent-glow)] hover:!bg-[var(--accent-strong)]"
            onClick={() => void createSession({ title: UNTITLED_SESSION })}
            isLoading={isCreatingSession}
          >
            <Plus className="h-4 w-4" />
            New chat
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5">
          <div className="mb-4 flex items-center justify-between px-2">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--sidebar-muted)]">Sessions</p>
            <span className="text-xs text-[var(--sidebar-muted)]">{sessions.length}</span>
          </div>
          {isLoadingSessions ? (
            <div className="flex items-center justify-center py-10 text-[var(--sidebar-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : sessions.length > 0 ? (
            <div className="space-y-2">
              {sessions.map((session) => (
                <SessionListItem
                  key={session.id}
                  session={session}
                  isActive={session.id === currentSessionId}
                  onSelect={() => {
                    setCurrentSessionId(session.id);
                    setIsSidebarOpen(false);
                  }}
                  onDelete={() => void deleteSession(session.id)}
                />
              ))}
            </div>
          ) : (
            <Card className="rounded-[1.4rem] border-[var(--line)] bg-[var(--sidebar-surface)] p-4 text-sm text-[var(--sidebar-muted)]">
              No sessions yet. Start one from the composer and the message history will be stored here.
            </Card>
          )}
        </div>

        <div className="border-t border-[var(--line)] px-5 py-4 text-xs leading-6 text-[var(--sidebar-muted)]">
          The selected session controls both message history and workspace persistence.
        </div>
      </aside>

      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 flex items-center justify-between gap-4 border-b border-[var(--line)] bg-[color:color-mix(in_srgb,var(--surface)_72%,transparent)] px-3 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-raised)] text-[var(--ink)] lg:hidden"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </button>

            <Avatar
              type="custom"
              size="md"
              icon={<Bot className="h-4 w-4 text-[var(--accent-strong)]" />}
              className="border border-[var(--accent-soft)] bg-[var(--accent-soft)]"
            />

            <div className="min-w-0">
              {currentSession && isEditingTitle ? (
                <div className="flex items-center gap-2">
                  <input
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    className="w-[min(28rem,55vw)] rounded-full border border-[var(--line-strong)] bg-[var(--surface-raised)] px-4 py-2 text-sm text-[var(--ink)] outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-raised)] text-[var(--ink)]"
                    onClick={() => {
                      void updateSessionTitle(currentSession.id, titleDraft);
                      setIsEditingTitle(false);
                    }}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-raised)] text-[var(--muted)]"
                    onClick={() => {
                      setTitleDraft(getSessionTitle(currentSession));
                      setIsEditingTitle(false);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-['Playfair_Display'] text-[2rem] leading-none text-[var(--ink)]">
                      {currentSession ? getSessionTitle(currentSession) : 'New session'}
                    </h2>
                    {currentSession ? (
                      <button
                        type="button"
                        className="hidden h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-raised)] text-[var(--muted)] transition hover:text-[var(--ink)] sm:flex"
                        onClick={() => setIsEditingTitle(true)}
                      >
                        <PencilLine className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-[var(--muted)]">
                    <span className="flex items-center gap-1.5">
                      <History className="h-3.5 w-3.5" />
                      {currentSession ? currentSession.id : 'No active session'}
                    </span>
                    <span className="h-1 w-1 rounded-full bg-[var(--line-strong)]" />
                    <span className="flex items-center gap-1.5">
                      <Database className="h-3.5 w-3.5" />
                      SQLite-backed history
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex h-10 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--ink)] transition hover:border-[var(--line-strong)]"
              onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <SunMedium className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
            <Button
              variant="secondary"
              size="sm"
              className="!rounded-full border border-[var(--line)] bg-[var(--surface-raised)] text-[var(--ink)]"
              onClick={() => void createSession({ title: UNTITLED_SESSION })}
              isLoading={isCreatingSession}
            >
              <Plus className="h-4 w-4" />
              New chat
            </Button>
          </div>
        </header>

        {currentSession ? (
          <ConversationPane
            key={currentSession.id}
            session={currentSession}
            initialPrompt={
              pendingInitialPrompt?.sessionId === currentSession.id
                ? pendingInitialPrompt.text
                : null
            }
            onInitialPromptConsumed={() => {
              setPendingInitialPrompt((current) => (
                current?.sessionId === currentSession.id ? null : current
              ));
            }}
            onSessionRefresh={() => {
              void refreshSessions(currentSession.id);
            }}
            onSessionTitleSuggest={(title) => {
              if (isPlaceholderTitle(currentSession.metadata?.title)) {
                void updateSessionTitle(currentSession.id, title);
              }
            }}
          />
        ) : (
          <LandingStage
            input={landingInput}
            isCreatingSession={isCreatingSession}
            onInputChange={setLandingInput}
            onStartPrompt={(prompt) => {
              const trimmed = prompt.trim();
              if (!trimmed) {
                return;
              }

              void createSession({
                title: deriveSessionTitle(trimmed),
                seedPrompt: trimmed,
              });
            }}
            onCreateBlank={() => {
              void createSession({ title: UNTITLED_SESSION });
            }}
          />
        )}
      </div>
    </div>
  );
}
