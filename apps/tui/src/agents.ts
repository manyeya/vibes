import type { UIMessage } from 'ai';

/** A tab in the live-activity switcher: the main agent or a deployed sub-agent. */
export interface AgentTabInfo {
  /** 'main' for the orchestrator, otherwise the delegationId. */
  id: string;
  name: string;
  status: 'active' | 'complete' | 'failed';
  /** The task the sub-agent was delegated (shown in its isolated view). */
  task?: string;
}

type AnyPart = { type: string; data?: Record<string, unknown> };

/**
 * Which agent view a part belongs to. The delegation handoff itself stays on
 * 'main' (it's orchestration); anything else carrying a delegationId is the
 * sub-agent's own activity, keyed by delegationId.
 */
export function partAgent(part: { type: string; data?: unknown }): string {
  if (part.type === 'data-delegation') return 'main';
  const d = part.data as { delegationId?: string } | undefined;
  return d?.delegationId ?? 'main';
}

/**
 * Derive the agent tabs from the live message stream: 'main' plus one per
 * delegationId. Mirrors the web demo — a delegation part sets the sub-agent's
 * name/status/task; any other part carrying a delegationId also surfaces it.
 */
export function deriveAgents(messages: UIMessage[]): AgentTabInfo[] {
  const toStatus = (s?: string): AgentTabInfo['status'] =>
    s === 'complete' ? 'complete' : s === 'failed' ? 'failed' : 'active';

  const subs = new Map<string, AgentTabInfo>();
  for (const m of messages) {
    for (const p of m.parts as AnyPart[]) {
      const d = p.data as { delegationId?: string; agentName?: string; task?: string; status?: string } | undefined;
      if (p.type === 'data-delegation' && d?.delegationId) {
        subs.set(d.delegationId, {
          id: d.delegationId,
          name: d.agentName ?? 'sub-agent',
          status: toStatus(d.status),
          task: d.task,
        });
      } else if (d?.delegationId && !subs.has(d.delegationId)) {
        subs.set(d.delegationId, { id: d.delegationId, name: d.agentName ?? 'sub-agent', status: 'active' });
      }
    }
  }

  return [{ id: 'main', name: 'Main agent', status: 'active' }, ...subs.values()];
}

/** Collect every part routed to one agent view, across all messages, in order. */
export function partsForAgent(messages: UIMessage[], agentId: string): AnyPart[] {
  const out: AnyPart[] = [];
  for (const m of messages) {
    for (const p of m.parts as AnyPart[]) {
      if (partAgent(p) === agentId) out.push(p);
    }
  }
  return out;
}
