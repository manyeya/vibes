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
  PanelRight,
  ArrowDown,
  ArrowUp,
  Coins,
} from 'lucide-react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { cn } from '../../lib/utils';
import { DataPartRenderer, isDataPart } from '../data-parts';
import { TextPart, ReasoningPart, ToolResultPart } from '../message-parts';

// Import new Vercel-style UI components
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Input';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { IconButton } from '../ui/IconButton';
import { Skeleton } from '../ui/Skeleton';
import { Divider } from '../ui/Divider';
import { ChatBubble } from './ChatBubble';
import { TypingIndicator } from './TypingIndicator';
import { SessionCard } from './SessionCard';
import { ModelSelector, type ModelOption } from './ModelSelector';
import { AgentSelector, type AgentOption } from './AgentSelector';
import { TaskChecklist, type ChecklistTask } from './TaskChecklist';
import { AgentTabs, type AgentTabInfo } from './AgentTabs';
import { ActivityStream, StatusStrip } from './ActivityStream';
import { ArtifactPanel } from '../artifacts/ArtifactPanel';
import { ArtifactsContext } from '../artifacts/ArtifactsContext';
import { ClarificationForm } from './ClarificationForm';
import { PlanReviewForm } from './PlanReviewForm';
import { CommandMenu } from './CommandMenu';
import { useCommands, type Command, type PaletteCtx } from './command-providers';
import { ContextGauge } from './ContextGauge';
import { LiveActivity } from './LiveActivity';
import { SessionSidebar } from './SessionSidebar';
import { ChatMessage } from './ChatMessage';
import type { Session, SessionUsage } from './session-types';
import type { ArtifactData, ClarificationData, ContextUsageData, PlanReviewData } from '../data-parts/types';

interface LiveDataPart {
  key: string;
  type: string;
  data: unknown;
}

// Data-part types aggregated elsewhere (activity rail, task checklist) and
// therefore NOT rendered as loose cards in the chat stream.
const SUPPRESSED_CHAT_PARTS = new Set([
  'data-tool_progress',
  'data-status',
  'data-task_update',
  'data-task_graph',
  'data-clarification', // rendered as the questionnaire form above the composer
  'data-plan_review',   // rendered as the plan-approval form above the composer
  'data-context_usage', // rendered as the context gauge in the composer footer
]);

// ============ MAIN CHAT AREA ============
function formatTokens(n: number): string {
  if (!n) return '0';
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Estimated USD cost for the session, or null when it's free (every free
 * OpenRouter model prices at 0) — we omit the chip rather than render a
 * misleading "$0.00".
 */
function estimateCost(usage: SessionUsage | undefined, model: ModelOption | undefined): string | null {
  if (!usage) return null;
  const cost =
    (usage.inputTokens / 1_000_000) * (model?.priceIn ?? 0) +
    (usage.outputTokens / 1_000_000) * (model?.priceOut ?? 0);
  if (!cost) return null;
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

interface ChatAreaProps {
  sessionId: string;
  model?: string;
  models: ModelOption[];
  onModelChange: (id: string) => void;
  /** Web-search backend preference from Settings ('auto' | 'exa' | 'tavily' | 'brave'). */
  searchProvider?: string;
  usage?: SessionUsage;
  onSessionUpdate: () => void;
}

export const ChatArea = ({ sessionId, model, models, onModelChange, searchProvider, usage, onSessionUpdate }: ChatAreaProps) => {
  const [input, setInput] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [dataParts, setDataParts] = useState<LiveDataPart[]>([]);
  // Canvas panel: which artifact is focused, and whether the panel is open.
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Live activity rail: which agent's work is shown ('main' or a delegationId).
  const [activeAgent, setActiveAgent] = useState<string>('main');
  // Built-in sub-agents + the one this message is targeted at ('' = Auto, the
  // orchestrator decides). Picking one routes the next message to it.
  const [agentRoster, setAgentRoster] = useState<AgentOption[]>([]);
  const [targetAgent, setTargetAgent] = useState<string>('');

  // Clarification questionnaires the user has already answered (by id), so the
  // form clears once submitted.
  const [answeredClarifications, setAnsweredClarifications] = useState<Set<string>>(() => new Set());
  // Plan reviews the user has already acted on (by id), so the form clears once
  // approved / changes-requested.
  const [answeredPlanReviews, setAnsweredPlanReviews] = useState<Set<string>>(() => new Set());

  // Keep the selected model + search provider in refs so the transport
  // (created once) always reads the latest value — including on automatic
  // tool-approval resends.
  const modelRef = useRef(model);
  modelRef.current = model;
  const searchProviderRef = useRef(searchProvider);
  searchProviderRef.current = searchProvider;

  // Recover an interrupted run after the device sleeps: track whether a run is
  // in flight (persisted, so it survives a reload) and resume on wake.
  const [runInFlight, setRunInFlight] = useState<boolean>(() => {
    try { return localStorage.getItem(`vibes_inflight_${sessionId}`) === '1'; } catch { return false; }
  });

  const { messages, sendMessage, status, addToolApprovalResponse, error, stop, setMessages, resumeStream } = useChat({
    id: sessionId,
    transport: new DefaultChatTransport({
      api: '/api/vibe/stream',
      headers: { 'Content-Type': 'application/json' },
      prepareSendMessagesRequest: ({ body, messages }) => ({
        body: {
          ...(body ?? {}),
          messages,
          session_id: sessionId,
          model: modelRef.current || undefined,
          search_provider: searchProviderRef.current || undefined,
        },
      }),
      // Wake/online recovery: the AI SDK calls this to reconnect to an
      // interrupted run; the server resolves the session's active stream.
      prepareReconnectToStreamRequest: ({ id }) => ({ api: `/api/vibe/${id}/reconnect` }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => setRunInFlight(false),

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
        case 'data-command':
        case 'data-file_operation':
        case 'data-skill':
        case 'data-agent_message':
        case 'data-agent_thought':
        case 'data-clarification':
        case 'data-plan_review':
        case 'data-context_usage':
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

  // ── interrupted-run recovery (sleep/wake) ───────────────────────────────
  // Mark a run in flight when it starts; cleared on a clean finish (onFinish).
  useEffect(() => {
    if (status === 'submitted' || status === 'streaming') setRunInFlight(true);
  }, [status]);

  // Persist the flag so a reload mid-run still knows to recover.
  useEffect(() => {
    try {
      if (runInFlight) localStorage.setItem(`vibes_inflight_${sessionId}`, '1');
      else localStorage.removeItem(`vibes_inflight_${sessionId}`);
    } catch { /* ignore */ }
  }, [runInFlight, sessionId]);

  // On wake (tab visible / back online / window focus) try to resume the run.
  const statusRef = useRef(status); statusRef.current = status;
  const inFlightRef = useRef(runInFlight); inFlightRef.current = runInFlight;
  const loadingRef = useRef(isLoadingHistory); loadingRef.current = isLoadingHistory;
  useEffect(() => {
    const tryResume = () => {
      if (!inFlightRef.current || loadingRef.current) return;
      if (statusRef.current === 'streaming' || statusRef.current === 'submitted') return;
      void resumeStream?.();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') tryResume(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', tryResume);
    window.addEventListener('focus', tryResume);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', tryResume);
      window.removeEventListener('focus', tryResume);
    };
  }, [resumeStream]);

  // Reload mid-run: once history has loaded and we're idle, attempt a resume.
  useEffect(() => {
    if (!isLoadingHistory && inFlightRef.current && statusRef.current === 'ready') void resumeStream?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingHistory]);

  const resumeInterrupted = useCallback(() => {
    setRunInFlight(false); // cleared, then re-set when the new run starts
    sendMessage({ text: 'The previous run was interrupted (my device slept). Continue the task from where you left off.' });
  }, [sendMessage]);

  // Load the built-in sub-agent roster for the composer's agent picker.
  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((d) => { if (d?.success && Array.isArray(d.agents)) setAgentRoster(d.agents); })
      .catch(() => { /* picker just shows Auto if this fails */ });
  }, []);

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

  // The artifact currently being *written* by the model. Only `create_artifact`
  // streams full `content` (a new artifact, OR a full regeneration when it carries
  // an existing `id`), so its title/kind/content deltas render into the canvas
  // live instead of waiting for the finished file. `edit_artifact` sends a diff
  // (old/new_string), not content, so it has no live preview — it renders on
  // completion. New creates use a transient `pending:` id; a regenerate reuses id.
  const streamingArtifact = useMemo<ArtifactData | null>(() => {
    const KINDS = ['html', 'markdown', 'mermaid', 'chart'];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as any;
      if (m?.role !== 'assistant') continue;
      const parts = m.parts ?? [];
      for (let j = parts.length - 1; j >= 0; j--) {
        const p = parts[j];
        if (p?.type !== 'tool-create_artifact') continue;
        // Most recent artifact tool call: only a live one (not yet executed) streams.
        if (p.state !== 'input-streaming' && p.state !== 'input-available') return null;
        const input = (p.input ?? {}) as { id?: string; title?: string; kind?: string; content?: string };
        const content = typeof input.content === 'string' ? input.content : '';
        if (!content && !input.title) return null; // nothing meaningful yet
        const id = input.id ? input.id : `pending:${p.toolCallId}`;
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

  // Some AI SDK data parts arrive by mutating the active assistant message's
  // `parts` array without also passing through `onData`. Live side views should
  // read those message parts too, otherwise they lag behind the streamed turn.
  const messageLiveParts = useMemo<LiveDataPart[]>(() => {
    if (!activeAssistant) return [];
    const extracted: LiveDataPart[] = [];
    const assistantId = (activeAssistant as any).id ?? 'assistant';
    for (const [index, rawPart] of ((activeAssistant as any).parts ?? []).entries()) {
      const part = rawPart?.type === 'data' && isDataPart(rawPart.data) ? rawPart.data : rawPart;
      if (!isDataPart(part)) continue;
      const partId = typeof (part as any).id === 'string' && (part as any).id.length > 0
        ? `${part.type}:${(part as any).id}`
        : `${assistantId}:${index}:${part.type}`;
      extracted.push({ key: partId, type: part.type, data: part.data });
    }
    return extracted;
  }, [activeAssistant]);

  const liveParts = useMemo<LiveDataPart[]>(() => {
    const map = new Map<string, LiveDataPart>();
    for (const part of dataParts) map.set(part.key, part);
    for (const part of messageLiveParts) map.set(part.key, part);
    return Array.from(map.values());
  }, [dataParts, messageLiveParts]);

  // Deployed sub-agents, derived from the live delegation stream. Each becomes a
  // tab above the composer so its own work can be viewed in isolation.
  const agents = useMemo<AgentTabInfo[]>(() => {
    const toStatus = (s?: string): AgentTabInfo['status'] =>
      s === 'complete' ? 'complete' : s === 'failed' ? 'failed' : 'active';
    const subs = new Map<string, AgentTabInfo>();
    for (const p of liveParts) {
      const d = p.data as any;
      if (p.type === 'data-delegation' && d?.delegationId) {
        subs.set(d.delegationId, { id: d.delegationId, name: d.agentName ?? 'Sub-agent', status: toStatus(d.status), task: d.task });
      }
    }
    // Fallback: a sub-agent that streamed work before its delegation card.
    for (const p of liveParts) {
      const d = p.data as any;
      if (p.type !== 'data-delegation' && d?.delegationId && !subs.has(d.delegationId)) {
        subs.set(d.delegationId, { id: d.delegationId, name: d.agentName ?? 'Sub-agent', status: 'active' });
      }
    }
    return [{ id: 'main', name: 'Main agent', status: 'active' }, ...subs.values()];
  }, [liveParts]);

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
    () => liveParts.filter((p) => partAgentId(p) === effectiveAgent),
    [liveParts, effectiveAgent],
  );

  // The latest clarification the agent asked that the user hasn't answered yet —
  // drives the questionnaire form above the composer. (The agent's run stops
  // after asking, so this is shown while idle.)
  //
  // "Answered" is detected two ways: the in-memory `answeredClarifications` set
  // (instant, same-session, no flicker when you submit) AND the persisted
  // timeline — if a user message exists *after* the clarification, it was
  // answered. The `ask_user` tool halts the agent, so the next user message is
  // the answer. The timeline check is what survives leaving and reopening a
  // session (where the in-memory set is gone), fixing the form reappearing.
  const activeClarification = useMemo<ClarificationData | null>(() => {
    let latest: ClarificationData | null = null;
    let latestUserCount = 0; // user messages seen up to the latest clarification
    let userCount = 0;
    for (const m of messages as any[]) {
      if (m?.role === 'user') userCount++;
      for (const p of (m?.parts ?? [])) {
        if (p?.type === 'data-clarification' && p?.data?.id) {
          latest = p.data as ClarificationData;
          latestUserCount = userCount;
        }
      }
    }
    // Live streamed parts (current turn, not yet persisted) — no user answer
    // can have arrived after a clarification still streaming in this turn.
    for (const p of dataParts) {
      if (p.type === 'data-clarification' && (p.data as any)?.id) {
        latest = p.data as ClarificationData;
        latestUserCount = userCount;
      }
    }
    if (!latest) return null;
    const answeredInTimeline = userCount > latestUserCount;
    const answeredInSession = answeredClarifications.has(latest.id);
    return answeredInTimeline || answeredInSession ? null : latest;
  }, [messages, dataParts, answeredClarifications]);

  // The latest plan the agent put up for review that the user hasn't acted on —
  // drives the approve / request-changes form above the composer. Same
  // "answered" detection as clarifications: a user message after the review (the
  // agent halts on request_plan_review) or the in-memory set means it's handled.
  const activePlanReview = useMemo<PlanReviewData | null>(() => {
    let latest: PlanReviewData | null = null;
    let latestUserCount = 0;
    let userCount = 0;
    for (const m of messages as any[]) {
      if (m?.role === 'user') userCount++;
      for (const p of (m?.parts ?? [])) {
        if (p?.type === 'data-plan_review' && p?.data?.id) {
          latest = p.data as PlanReviewData;
          latestUserCount = userCount;
        }
      }
    }
    for (const p of dataParts) {
      if (p.type === 'data-plan_review' && (p.data as any)?.id) {
        latest = p.data as PlanReviewData;
        latestUserCount = userCount;
      }
    }
    if (!latest) return null;
    const answered = userCount > latestUserCount || answeredPlanReviews.has(latest.id);
    return answered ? null : latest;
  }, [messages, dataParts, answeredPlanReviews]);

  // Latest context-window usage per agent (persisted in message parts + streamed
  // live). The main conversation is the entry with no delegationId; each
  // delegated sub-agent emits its own, keyed by delegationId.
  const contextUsageByAgent = useMemo(() => {
    const map = new Map<string, ContextUsageData>();
    const scan = (type?: string, data?: any) => {
      if (type === 'data-context_usage' && typeof data?.contextWindow === 'number') {
        map.set(data.delegationId ?? 'main', data as ContextUsageData);
      }
    };
    for (const m of messages as any[]) {
      for (const p of (m?.parts ?? [])) scan(p?.type, p?.data);
    }
    for (const p of dataParts) scan(p.type, p.data as any);
    return map;
  }, [messages, dataParts]);

  // Main-conversation gauge (composer footer) — never shows a sub-agent's value.
  const contextUsage = contextUsageByAgent.get('main') ?? null;
  // The active sub-agent's own gauge, shown under its tab so you can see how
  // much context the delegation consumed as a separate thing.
  const subAgentUsage = activeSubAgent ? contextUsageByAgent.get(activeSubAgent.id) ?? null : null;

  // ---- Stick-to-bottom scrolling --------------------------------------------
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };
  const onScroll = () => {
    const el = scrollRef.current;
    const b = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stick.current = b;
    setAtBottom(b);
  };

  // Follow growing content (streaming tokens, new messages) while the user is
  // parked at the bottom — a ResizeObserver catches every height change, so we
  // don't enumerate what grew. Scrolling up cancels the follow; scrolling back
  // to the bottom resumes it.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const ro = new ResizeObserver(() => { if (stick.current) scrollToBottom(false); });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  // Land at the latest message when history finishes loading or the viewed
  // agent tab changes.
  useEffect(() => {
    if (isLoadingHistory) return;
    stick.current = true;
    setAtBottom(true);
    requestAnimationFrame(() => scrollToBottom(false));
  }, [isLoadingHistory, effectiveAgent]);

  // Send a message; if a clarification is pending, mark it answered so the form
  // clears regardless of whether the user used the form or the composer.
  const sendUserMessage = (text: string) => {
    if (!text.trim()) return;
    const isFirstMessage = messages.length === 0 && !isLoadingHistory;
    if (activeClarification) {
      setAnsweredClarifications((prev) => new Set(prev).add(activeClarification.id));
    }
    if (activePlanReview) {
      setAnsweredPlanReviews((prev) => new Set(prev).add(activePlanReview.id));
    }
    setDataParts([]);
    setActiveAgent('main');
    stick.current = true;
    setAtBottom(true);
    sendMessage({ text });
    requestAnimationFrame(() => scrollToBottom(false));

    // Title an "Untitled session" from its first message, like ChatGPT/Claude.
    if (isFirstMessage) {
      const condensed = text.replace(/\s+/g, ' ').trim();
      const title = condensed.length > 48 ? `${condensed.slice(0, 48).trimEnd()}…` : condensed;
      fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
        .then(() => onSessionUpdate())
        .catch(() => { /* keep the placeholder title if the rename fails */ });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      // Targeting an agent frames the message as a delegation directive so the
      // orchestrator routes it to that specialist; Auto sends it verbatim.
      const text = targetAgent
        ? `Delegate this to the \`${targetAgent}\` sub-agent and report back its result:\n\n${input}`
        : input;
      sendUserMessage(text);
      setInput('');
    }
  };

  // ── slash-command palette ──────────────────────────────────────────────────
  const commands = useCommands();
  const [commandForm, setCommandForm] = useState<React.ReactNode>(null);
  const [menuIndex, setMenuIndex] = useState(0);

  const slashActive = input.startsWith('/') && !input.includes('\n');
  const slashQuery = slashActive ? input.slice(1).trim().toLowerCase() : '';
  const filteredCommands = useMemo<Command[]>(() => {
    if (!slashActive) return [];
    const toks = slashQuery.split(/\s+/).filter(Boolean);
    return commands
      .filter((c) => {
        const hay = [c.label, c.slug ?? '', c.kind, ...(c.keywords ?? [])].join(' ').toLowerCase();
        return toks.every((t) => hay.includes(t));
      })
      .slice(0, 8);
  }, [slashActive, slashQuery, commands]);

  useEffect(() => { setMenuIndex(0); }, [slashQuery, slashActive]);

  const runWorkflowCmd = useCallback(async (nameOrId: string, inputs: Record<string, unknown>) => {
    setCommandForm(null);
    setInput('');
    try {
      const res = await fetch(`/api/vibe/${sessionId}/workflows/${encodeURIComponent(nameOrId)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs, model: modelRef.current || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) { console.error('[workflow run] failed:', data); return; }
      // Tail the (resumable) run into the thread.
      setActiveAgent('main');
      stick.current = true;
      setAtBottom(true);
      requestAnimationFrame(() => scrollToBottom(false));
      await resumeStream?.();
    } catch (err) {
      console.error('[workflow run] error:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, resumeStream]);

  const paletteCtx: PaletteCtx = {
    openForm: (form) => { setCommandForm(form); setInput(''); },
    closeForm: () => setCommandForm(null),
    sendUserMessage,
    insertText: (t) => setInput(t),
    runWorkflow: runWorkflowCmd,
  };
  const selectCommand = (c: Command) => c.run(paletteCtx);

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
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div ref={contentRef} className="max-w-3xl mx-auto px-4 py-6">
          {/* The main conversation only renders on the Main agent tab — a
              sub-agent tab is an isolated view of just that agent's work. */}
          {viewingMain && (isLoadingHistory ? (
            <div className="flex items-center justify-center gap-2 py-20 text-[color:var(--color-ink-faint)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="font-mono text-[12px] uppercase tracking-[0.18em]">Loading session</span>
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
                  An agent harness with planning, working memory, renderable
                  artifacts and a roster of specialist sub-agents. Describe a
                  goal — files, code, the browser, the lot.
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
                <span>{['planning', 'memory', 'artifacts', 'sub-agents'].join(' · ')}</span>
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
                {/* This sub-agent's own context usage, kept separate from the
                    main conversation's gauge in the composer footer. */}
                {subAgentUsage && (
                  <div className="ml-auto shrink-0">
                    <ContextGauge usage={subAgentUsage} />
                  </div>
                )}
              </div>
              {activeSubAgent.task && (
                <p className="mt-1.5 text-[13px] leading-relaxed text-[color:var(--color-ink-soft)]">{activeSubAgent.task}</p>
              )}
            </div>
          )}

          {/* Live activity for a SUB-AGENT tab stays in the main area (it's the
              focus when you're watching that agent). The MAIN agent's live
              activity moved to the panel above the composer (see LiveActivity)
              so process no longer piles up above the latest message. */}
          {!viewingMain && visibleParts.length > 0 && (
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
      {!atBottom && (
        <button
          type="button"
          onClick={() => { stick.current = true; setAtBottom(true); scrollToBottom(true); }}
          title="Jump to latest"
          aria-label="Jump to latest"
          className="absolute bottom-2 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)]/95 text-[color:var(--color-ink-soft)] shadow-lg shadow-black/40 backdrop-blur transition-colors hover:border-[color:var(--color-amber)] hover:text-[color:var(--color-ink)]"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}
      </div>

      {/* Composer */}
      <div className="shrink-0 px-4 pb-5 pt-3">
        {runInFlight && !isLoadingHistory && (status === 'ready' || status === 'error') && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-xl border border-[color:var(--color-amber)]/40 bg-[rgba(240,184,108,0.08)] px-3.5 py-2.5 text-[12.5px] text-[color:var(--color-ink-soft)]">
            <RefreshCw className="h-4 w-4 shrink-0 text-[color:var(--color-amber)]" />
            <span className="min-w-0 flex-1">A run was interrupted — your device may have slept. The work so far is saved.</span>
            <button
              type="button"
              onClick={resumeInterrupted}
              className="shrink-0 rounded-md bg-[color:var(--color-amber)] px-2.5 py-1 text-[12px] font-medium text-[color:var(--color-ground)] hover:opacity-90"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={() => setRunInFlight(false)}
              className="shrink-0 rounded-md px-2 py-1 text-[12px] text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)]"
            >
              Dismiss
            </button>
          </div>
        )}
        {activeClarification && !isLoading && (
          <ClarificationForm
            clarification={activeClarification}
            onSubmit={(text) => sendUserMessage(text)}
          />
        )}
        {activePlanReview && !isLoading && (
          <PlanReviewForm
            review={activePlanReview}
            onSubmit={(text) => sendUserMessage(text)}
          />
        )}
        {commandForm}
        {slashActive && (
          <CommandMenu
            commands={filteredCommands}
            activeIndex={menuIndex}
            onSelect={selectCommand}
            onHover={setMenuIndex}
          />
        )}
        <AgentTabs agents={agents} active={effectiveAgent} onSelect={setActiveAgent} />
        <TaskChecklist tasks={tasks} />
        {viewingMain && <LiveActivity parts={visibleParts} />}
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
          <div className="rounded-2xl border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] px-3.5 pt-3 pb-2 transition-all focus-within:border-[color:var(--color-amber)]/70 focus-within:shadow-[0_0_0_3px_rgba(240,184,108,0.08)]">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe a goal — Vibes plans, codes, and runs it."
              autoResize
              className="block w-full min-h-[76px] px-0 py-0 text-[15px] leading-relaxed text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-faint)]"
              onKeyDown={(e) => {
                // Inline args: "/<name> key=val key2=\"…\"" + Enter → run directly
                // (works even when the arg tokens don't match any menu item).
                if (slashActive && e.key === 'Enter' && !e.shiftKey) {
                  const bodyStr = input.slice(1);
                  const sp = bodyStr.indexOf(' ');
                  if (sp > 0) {
                    const token = bodyStr.slice(0, sp).toLowerCase();
                    const rest = bodyStr.slice(sp + 1).trim();
                    const wf = commands.find((c) => c.kind === 'workflow' && (c.label.toLowerCase() === token || c.slug?.toLowerCase() === token));
                    if (wf && rest) {
                      e.preventDefault();
                      const args: Record<string, string> = {};
                      for (const m of rest.matchAll(/([A-Za-z0-9_]+)=("([^"]*)"|'([^']*)'|(\S+))/g)) args[m[1]] = m[3] ?? m[4] ?? m[5] ?? '';
                      runWorkflowCmd(wf.label, args);
                      setInput('');
                      return;
                    }
                  }
                }
                if (slashActive && filteredCommands.length > 0) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setMenuIndex((i) => (i + 1) % filteredCommands.length); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setMenuIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length); return; }
                  if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); selectCommand(filteredCommands[menuIndex]); return; }
                  if (e.key === 'Escape') { e.preventDefault(); setInput(''); return; }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              {/* Target a sub-agent for this message (Auto = orchestrator decides). */}
              <div className="flex items-center gap-1">
                {agentRoster.length > 0 && (
                  <AgentSelector agents={agentRoster} value={targetAgent} onChange={setTargetAgent} placement="top" />
                )}
              </div>

              {/* model selector + send */}
              <div className="flex items-center gap-2">
                {input.trim() && (
                  <span className="hidden font-mono text-[10px] text-[color:var(--color-ink-faint)] sm:inline">
                    ⇧↵ newline
                  </span>
                )}
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
        {/* Session + context meta — pulled below the composer so the in-box
            footer row stays free for commands, modes, and attachments. */}
        <div className="mx-auto mt-2 flex max-w-3xl items-center gap-3 px-1">
          {/* Primary: current context-window occupancy (Claude-Code style). */}
          {contextUsage ? (
            <ContextGauge usage={contextUsage} />
          ) : (
            <span className="font-mono text-[11px] text-[color:var(--color-ink-faint)]">context · idle</span>
          )}
          <span className="text-[color:var(--color-ink-faint)] opacity-30">·</span>
          {/* Secondary: cumulative tokens billed this session (+ cost when paid). */}
          {(() => {
            const cost = estimateCost(usage, models.find((m) => m.id === model));
            return (
              <div
                className="flex items-center gap-1.5 font-mono text-[11px] text-[color:var(--color-ink-faint)]"
                title="Tokens billed this session (each step re-sends the growing context, so this is cumulative — not the current window)."
              >
                <Coins className="h-3.5 w-3.5" />
                <span>{formatTokens(usage?.totalTokens ?? 0)}</span>
                {cost && (
                  <>
                    <span className="opacity-40">·</span>
                    <span className="text-[color:var(--color-ink-soft)]">{cost}</span>
                  </>
                )}
              </div>
            );
          })()}
          {viewingMain && panelArtifacts.length > 0 && !panelOpen && (
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              title="Open the artifact canvas"
              className="ml-auto flex items-center gap-1.5 rounded-md border border-[color:var(--color-line-strong)] px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-soft)] transition-colors hover:border-[color:var(--color-amber)] hover:text-[color:var(--color-ink)]"
            >
              <PanelRight className="h-3 w-3" />
              Canvas{panelArtifacts.length > 1 ? ` · ${panelArtifacts.length}` : ''}
            </button>
          )}
        </div>
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
