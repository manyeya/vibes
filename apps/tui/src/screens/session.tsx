import { useChat } from '@ai-sdk/react';
import type { TextareaRenderable } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { API_URL, abortSession, getMessages, patchSession, shortModel, type GitInfo, type SessionInfo } from '../api';
import { deriveAgents } from '../agents';
import { COMMANDS, parseCommand, type AppAction } from '../commands';
import { AgentTabs, SubAgentActivity } from '../components/agent-tabs';
import { ApprovalPrompt, type ApprovalRequest } from '../components/approval-prompt';
import { ArtifactDialog, type ArtifactData } from '../components/artifact-dialog';
import { Footer } from '../components/footer';
import { AssistantMessage, ErrorBlock, UserMessage } from '../components/messages';
import { PlanReview, type PlanReviewData } from '../components/plan-review';
import { Prompt } from '../components/prompt';
import { TaskPanel } from '../components/task-panel';
import { deriveTasks } from '../derive-tasks';
import { ContextDecisionPrompt, type ContextDecisionData } from '../components/context-decision';
import { RewindDialog } from '../components/rewind-dialog';
import { QuestionPrompt, type ClarificationData } from '../components/question';
import { sessionTitle } from '../components/session-dialog';
import { theme } from '../theme';
import { playDone } from '../sound';

interface ContextUsage {
  usedTokens: number;
  contextWindow: number;
}

export function Session({
  session,
  initialText,
  active,
  connected,
  model,
  mode = 'auto',
  onModeChange,
  cwd,
  git,
  onAppAction,
}: {
  session: SessionInfo;
  initialText?: string;
  active: boolean;
  connected: boolean;
  model?: string;
  mode?: string;
  onModeChange?: (mode: string) => void;
  cwd?: string;
  git?: GitInfo | null;
  onAppAction: (action: AppAction) => void;
}) {
  const [statusMsg, setStatusMsg] = useState('');
  const [title, setTitle] = useState(() => sessionTitle(session));
  const [answered, setAnswered] = useState<Set<string>>(() => new Set());
  const [reviewed, setReviewed] = useState<Set<string>>(() => new Set());
  const [contextAnswered, setContextAnswered] = useState<Set<string>>(() => new Set());
  const [rewindOpen, setRewindOpen] = useState(false);
  // Which agent's activity the transcript shows: 'main' or a delegationId.
  const [activeAgent, setActiveAgent] = useState('main');
  const titledRef = useRef(false);
  const sentInitial = useRef(false);

  // Model switches mid-session apply to the next turn (model is per-request).
  const modelRef = useRef(model);
  modelRef.current = model;

  // Same for mode — sent per request; the agent may also switch it mid-run.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // Set when the user answers a context prompt; read by the very next request.
  const contextDecisionRef = useRef<'compact' | 'continue' | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_URL}/api/vibe/stream`,
        // NB: no explicit Content-Type — the transport already sends
        // application/json and duplicating the header breaks server parsing.
        prepareSendMessagesRequest: ({ body, messages }) => ({
          body: {
            ...(body ?? {}),
            messages,
            session_id: session.id,
            model: modelRef.current || undefined,
            mode: modeRef.current || undefined,
            // Answer to a context-threshold halt; consumed once, then cleared.
            context_decision: contextDecisionRef.current || undefined,
          },
        }),
        prepareReconnectToStreamRequest: ({ id }) => ({
          api: `${API_URL}/api/vibe/${id}/reconnect`,
        }),
      }),
    [session.id],
  );

  const { messages, sendMessage, status, stop, setMessages, error, addToolApprovalResponse, resumeStream } = useChat({
    id: session.id,
    transport,
    // Without this, approving a tool only records the response — nothing resends
    // it, so the run just stops. This resumes automatically once every pending
    // approval on the last turn has an answer.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onData: (part) => {
      const data = part.data as Record<string, unknown>;
      switch (part.type) {
        case 'data-status':
        case 'data-notification':
          setStatusMsg(String(data.message ?? ''));
          break;
        case 'data-tool_progress':
          setStatusMsg(String(data.message ?? `${data.toolName ?? ''} ${data.stage ?? ''}`));
          break;
        case 'data-summarization':
          setStatusMsg(data.stage === 'complete' ? '' : 'compacting context…');
          break;
        case 'data-agent_message':
        case 'data-agent_thought': {
          const text = String(data.text ?? '');
          if (text) setStatusMsg(`${data.agentName ?? 'agent'}: ${text.slice(-60)}`);
          break;
        }
        case 'data-mode':
          // Only APPLIED changes move the UI mode. A suggestion (data.suggested)
          // is the agent proposing — the user decides, so it must not switch.
          if (data.mode && !data.suggested) onModeChange?.(String(data.mode));
          break;
      }
    },
    onFinish: () => setStatusMsg(''),
  });

  const busy = status === 'streaming' || status === 'submitted';

  // Stamp each finished turn's duration on its assistant message id, so the
  // message footer can show it Claude Code-style. Local-only: reloaded
  // history has no recorded start time, so old messages just omit it.
  const [durations, setDurations] = useState<Record<string, number>>({});
  const turnStart = useRef<number | null>(null);
  const lastMsg = messages[messages.length - 1];
  const lastId = lastMsg?.role === 'assistant' ? lastMsg.id : undefined;
  useEffect(() => {
    if (busy) {
      turnStart.current ??= Date.now();
      return;
    }
    if (turnStart.current && lastId) {
      const secs = Math.round((Date.now() - turnStart.current) / 1000);
      setDurations((d) => ({ ...d, [lastId]: secs }));
      playDone(); // task done — chime once per completed turn (guard skips load/reconnect)
    }
    turnStart.current = null;
  }, [busy, lastId]);

  const promptRef = useRef<TextareaRenderable>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [hint, setHint] = useState('');
  const lastSent = useRef('');
  const interruptedRef = useRef(false);

  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(''), 4000);
    return () => clearTimeout(timer);
  }, [hint]);

  const submit = (text: string) => {
    const cmd = parseCommand(text);
    if (cmd) {
      // Commands run immediately, even mid-turn — they never queue.
      if (cmd === 'unknown') setHint(`unknown command — ${COMMANDS.map((c) => `/${c.name}`).join(' ')}`);
      else if (cmd.action === 'artifacts') setArtifactsOpen(true);
      else if (cmd.action === 'rewind') setRewindOpen(true);
      else onAppAction(cmd.action);
      return;
    }
    if (busy) {
      // Claude Code-style queueing instead of silently dropping the message.
      setQueue((q) => [...q, text]);
      return;
    }
    lastSent.current = text;
    setActiveAgent('main'); // a new turn always starts on the main view
    if (!titledRef.current) {
      titledRef.current = true;
      const newTitle = text.slice(0, 48);
      setTitle(newTitle);
      patchSession(session.id, { title: newTitle }).catch(() => {});
    }
    void sendMessage({ text });
  };

  // Hardening: a failed send cleared the composer — put the text back.
  useEffect(() => {
    if (!error) return;
    const ta = promptRef.current;
    if (lastSent.current && ta && !ta.plainText.trim()) {
      ta.insertText(lastSent.current);
      lastSent.current = '';
    }
  }, [error]);

  // Drain the queue when the turn ends: natural finish sends everything as
  // one message; an interrupt or error restores it to the composer instead.
  useEffect(() => {
    if (busy) return;
    if (queue.length === 0) {
      interruptedRef.current = false;
      return;
    }
    const joined = queue.join('\n\n');
    setQueue([]);
    if (interruptedRef.current || error) {
      interruptedRef.current = false;
      const ta = promptRef.current;
      ta?.insertText(ta.plainText.trim() ? `\n\n${joined}` : joined);
    } else {
      submit(joined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, queue, error]);

  useEffect(() => {
    getMessages(session.id)
      .then((history) => {
        if (history.length > 0) {
          titledRef.current = true;
          setMessages(history);
        }
        if (initialText && !sentInitial.current && history.length === 0) {
          sentInitial.current = true;
          submit(initialText);
        }
      })
      .catch(() => {
        if (initialText && !sentInitial.current) {
          sentInitial.current = true;
          submit(initialText);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // Latest version of each artifact streamed this session (parts have stable
  // ids and update in place; later messages win via Map insertion order).
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const artifacts = useMemo(() => {
    const map = new Map<string, ArtifactData>();
    for (const m of messages) {
      for (const p of m.parts) {
        if (p.type === 'data-artifact') {
          const data = (p as { data?: ArtifactData }).data;
          if (data?.id) map.set(data.id, data);
        }
      }
    }
    return [...map.values()];
  }, [messages]);

  // Live-activity tabs: 'main' + one per deployed sub-agent, derived from the
  // delegation stream. ctrl+←/→ cycles the view.
  const agents = useMemo(() => deriveAgents(messages), [messages]);
  const effectiveAgent = agents.some((a) => a.id === activeAgent) ? activeAgent : 'main';
  const activeSubAgent = effectiveAgent === 'main' ? undefined : agents.find((a) => a.id === effectiveAgent);

  useKeyboard((key) => {
    if (key.name === 'escape' && active && busy && !artifactsOpen) {
      interruptedRef.current = true;
      abortSession(session.id).catch(() => {});
      stop();
    }
    if (key.ctrl && key.name === 'e' && active) setArtifactsOpen((v) => !v);
    // ctrl+t cycles the live-activity view (Main → sub-agents → Main). Single
    // key + wrap: ctrl+arrows collide with macOS Spaces switching.
    if (key.ctrl && key.name === 't' && active && agents.length > 1) {
      const idx = agents.findIndex((a) => a.id === effectiveAgent);
      setActiveAgent(agents[(idx + 1) % agents.length]!.id);
    }
  });

  // Derived from messages (not onData) so the gauge survives history reload;
  // the part has a stable id and updates in place, so the last one wins.
  const ctx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (let j = messages[i]!.parts.length - 1; j >= 0; j--) {
        const part = messages[i]!.parts[j]!;
        if (part.type === 'data-context_usage') return (part as { data: ContextUsage }).data;
      }
    }
    return null;
  }, [messages]);

  const ctxPct = ctx ? Math.round((ctx.usedTokens / ctx.contextWindow) * 100) : null;
  const last = messages[messages.length - 1];

  // ponytail: chars/4 estimate over this turn's streamed text/reasoning,
  // real per-token counts would need provider deltas the stream doesn't carry.
  const tokens =
    busy && last?.role === 'assistant'
      ? Math.round(
          last.parts.reduce((n, p) => {
            const text = (p as { text?: unknown }).text;
            return n + (typeof text === 'string' ? text.length : 0);
          }, 0) / 4,
        )
      : null;

  // The agent halts after ask_user; when the conversation ends on an
  // unanswered clarification, pin the interactive form above the composer.
  const clarification = (() => {
    if (busy || !last || last.role !== 'assistant') return undefined;
    for (let i = last.parts.length - 1; i >= 0; i--) {
      const part = last.parts[i]!;
      if (part.type === 'data-clarification') {
        const data = (part as { data: ClarificationData }).data;
        return data && !answered.has(data.id) ? data : undefined;
      }
    }
    return undefined;
  })();

  const answerClarification = (text: string) => {
    if (clarification) setAnswered((prev) => new Set(prev).add(clarification.id));
    submit(text);
  };

  // request_plan_review halts the run (haltOnToolCall); when the turn ends on an
  // un-acted plan review, pin the Approve / Request-changes form above the
  // composer. The decision goes back as the next message, resuming the agent.
  const planReview = (() => {
    if (busy || clarification || !last || last.role !== 'assistant') return undefined;
    for (let i = last.parts.length - 1; i >= 0; i--) {
      const part = last.parts[i]!;
      if (part.type === 'data-plan_review') {
        const data = (part as { data: PlanReviewData }).data;
        return data && !reviewed.has(data.id) ? data : undefined;
      }
    }
    return undefined;
  })();

  // The run halts at the context threshold rather than compacting silently;
  // pin the choice above the composer, same shape as the plan review.
  const contextDecision = (() => {
    if (busy || clarification || !last || last.role !== 'assistant') return undefined;
    for (let i = last.parts.length - 1; i >= 0; i--) {
      const part = last.parts[i]!;
      if (part.type === 'data-context_decision') {
        const data = (part as { data: ContextDecisionData }).data;
        return data && !contextAnswered.has(data.id) ? data : undefined;
      }
    }
    return undefined;
  })();

  const decideContext = (choice: 'compact' | 'continue') => {
    if (contextDecision) setContextAnswered((prev) => new Set(prev).add(contextDecision.id));
    // Rides on the next request (see the transport's prepareSendMessagesRequest)
    // and is cleared straight after so it applies to exactly one turn.
    contextDecisionRef.current = choice;
    submit(choice === 'compact'
      ? 'Compact the context and continue.'
      : 'Keep the full context and continue.');
    contextDecisionRef.current = null;
  };

  const decidePlan = (text: string, mode?: 'auto-edit' | 'manual') => {
    if (planReview) setReviewed((prev) => new Set(prev).add(planReview.id));
    // Approving leaves plan mode (Claude Code-style): update the ref now so THIS
    // turn's request carries the new mode — setMode's state update lands too late
    // for the synchronous submit below — and onModeChange for the footer/app state.
    if (mode) {
      modeRef.current = mode;
      onModeChange?.(mode);
    }
    submit(text);
  };

  // Tool approval (manual / auto-edit modes): the run halts with an
  // approval-requested tool part. Pin it above the composer; responding via
  // addToolApprovalResponse resumes the run. Without this the turn just froze.
  const respondedApprovals = useRef<Set<string>>(new Set());
  const pendingApproval = ((): ApprovalRequest | undefined => {
    if (busy || !last || last.role !== 'assistant') return undefined;
    for (const part of last.parts) {
      const p = part as { approval?: { id?: string }; type?: string; toolName?: string; input?: unknown };
      if (p.approval?.id && !respondedApprovals.current.has(p.approval.id)) {
        const name = p.type === 'dynamic-tool' ? (p.toolName ?? 'tool') : String(p.type ?? '').replace(/^tool-/, '');
        return { id: p.approval.id, toolName: name, input: p.input };
      }
    }
    return undefined;
  })();

  const respondApproval = (approved: boolean) => {
    if (!pendingApproval) return;
    respondedApprovals.current.add(pendingApproval.id);
    addToolApprovalResponse({ id: pendingApproval.id, approved, reason: approved ? 'Approved' : 'Denied' });
  };

  // Live task list for the sticky panel — latest graph wins, scoped to this
  // turn. See deriveTasks for why both of those matter.
  const tasks = useMemo(() => deriveTasks(messages as any), [messages]);

  return (
    <box flexGrow={1} backgroundColor={theme.background} paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
        <box height={1} />
        {activeSubAgent ? (
          <SubAgentActivity agent={activeSubAgent} messages={messages} busy={busy} />
        ) : (
          messages.map((m, i) =>
            m.role === 'user' ? (
              <UserMessage key={m.id} message={m} first={i === 0} />
            ) : (
              <AssistantMessage
                key={m.id}
                message={m}
                streaming={busy && m.id === last?.id}
                busy={busy}
                model={shortModel(model)}
                seconds={durations[m.id]}
                hideDelegated
              />
            ),
          )
        )}
        {error ? <ErrorBlock message={error.message} /> : null}
      </scrollbox>
      <AgentTabs agents={agents} active={effectiveAgent} onSelect={setActiveAgent} />
      {clarification ? (
        <QuestionPrompt
          key={clarification.id}
          data={clarification}
          active={active && !artifactsOpen}
          onSubmit={answerClarification}
          onDismiss={() => setAnswered((prev) => new Set(prev).add(clarification.id))}
        />
      ) : null}
      {contextDecision ? (
        <ContextDecisionPrompt
          key={contextDecision.id}
          data={contextDecision}
          active={active && !artifactsOpen}
          onChoose={decideContext}
          onDismiss={() => setContextAnswered((prev) => new Set(prev).add(contextDecision.id))}
        />
      ) : null}
      {planReview ? (
        <PlanReview
          key={planReview.id}
          data={planReview}
          active={active && !artifactsOpen}
          onSubmit={decidePlan}
          onDismiss={() => setReviewed((prev) => new Set(prev).add(planReview.id))}
        />
      ) : null}
      {pendingApproval ? (
        <ApprovalPrompt
          key={pendingApproval.id}
          request={pendingApproval}
          active={active && !artifactsOpen}
          onApprove={() => respondApproval(true)}
          onDeny={() => respondApproval(false)}
        />
      ) : null}
      {rewindOpen ? (
        <RewindDialog
          sessionId={session.id}
          messageCount={messages.length}
          onDone={({ kept }) => {
            setRewindOpen(false);
            // Drop the truncated tail locally so the view matches the server
            // (and the agent's context) without a refetch.
            setMessages((prev) => prev.slice(0, kept));
          }}
          onClose={() => setRewindOpen(false)}
        />
      ) : null}
      {artifactsOpen ? <ArtifactDialog artifacts={artifacts} onClose={() => setArtifactsOpen(false)} /> : null}
      {queue.length > 0 ? (
        <box flexShrink={0} paddingLeft={1}>
          {queue.map((q, i) => (
            <text key={i} fg={theme.textMuted} wrapMode="none" truncate>
              › {q}
            </text>
          ))}
        </box>
      ) : null}
      <TaskPanel tasks={tasks} busy={busy} />
      <Prompt
        placeholder=""
        focused={active && !clarification && !planReview && !contextDecision && !pendingApproval && !artifactsOpen}
        busy={busy}
        statusMsg={statusMsg}
        model={shortModel(model)}
        leftLabel={hint || title}
        tokens={tokens}
        onSubmit={submit}
        inputRef={promptRef}
      />
      <Footer connected={connected} cwd={cwd} git={git} ctxPct={ctxPct} mode={mode} />
    </box>
  );
}
