import { TextAttributes } from '@opentui/core';
import type { UIMessage } from 'ai';
import { partsForAgent, type AgentTabInfo } from '../agents';
import { theme } from '../theme';
import { DataPart } from './messages';
import { useHover } from './ui';

const glyph = (a: AgentTabInfo): string =>
  a.id === 'main' ? '◈' : a.status === 'complete' ? '✔' : a.status === 'failed' ? '✗' : '◐';

function Pill({ agent, on, onClick }: { agent: AgentTabInfo; on: boolean; onClick: () => void }) {
  const { hovered, onMouseOver, onMouseOut } = useHover();
  const idle = agent.status === 'complete';
  const fg = on
    ? theme.background
    : agent.status === 'failed'
      ? theme.error
      : idle
        ? theme.textMuted
        : theme.text;
  return (
    <box
      backgroundColor={on ? theme.primary : hovered ? theme.backgroundElement : undefined}
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
      onMouseOver={onMouseOver}
      onMouseOut={onMouseOut}
      onMouseDown={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <text fg={fg} attributes={on ? TextAttributes.BOLD : undefined} wrapMode="none">
        {glyph(agent)} {agent.id === 'main' ? 'Main' : agent.name}
      </text>
    </box>
  );
}

/**
 * The live-activity switcher above the composer: "Main" plus one pill per
 * deployed sub-agent, with a status glyph. Pills are clickable (hover-lit) and
 * ctrl+t cycles them. When a run fans out to many workers, finished ones
 * collapse into a compact "✔N ✗N done" pill so the bar never sprawls —
 * progressive disclosure, so the active work stays legible.
 */
export function AgentTabs({
  agents,
  active,
  onSelect,
}: {
  agents: AgentTabInfo[];
  active: string;
  onSelect: (id: string) => void;
}) {
  if (agents.length <= 1) return null;

  const main = agents.find((a) => a.id === 'main');
  const subs = agents.filter((a) => a.id !== 'main');
  const activeSubs = subs.filter((a) => a.status === 'active');
  const selectedDone = subs.find((a) => a.status !== 'active' && a.id === active);
  const inline = [...activeSubs, ...(selectedDone ? [selectedDone] : [])];
  const collapsed = subs.filter((a) => a.status !== 'active' && a.id !== selectedDone?.id);

  // Few workers → show them all; only collapse once the bar would sprawl.
  const collapse = subs.length > 4;
  const pills = collapse ? inline : subs;
  const done = collapse ? collapsed.filter((a) => a.status === 'complete').length : 0;
  const failed = collapse ? collapsed.filter((a) => a.status === 'failed').length : 0;

  return (
    <box flexDirection="row" gap={1} flexShrink={0} paddingLeft={1} paddingBottom={1}>
      <text fg={theme.textMuted} wrapMode="none">
        view
      </text>
      {main ? <Pill agent={main} on={active === 'main'} onClick={() => onSelect('main')} /> : null}
      {pills.map((a) => (
        <Pill key={a.id} agent={a} on={a.id === active} onClick={() => onSelect(a.id)} />
      ))}
      {collapse && collapsed.length > 0 ? (
        <Pill
          agent={{ id: 'done', name: `${done ? `✔${done} ` : ''}${failed ? `✗${failed} ` : ''}done`, status: 'complete' }}
          on={false}
          onClick={() => onSelect(collapsed[0]!.id)}
        />
      ) : null}
      <text fg={theme.textMuted} wrapMode="none">
        {'  '}ctrl+t
      </text>
    </box>
  );
}

/**
 * One sub-agent's isolated activity rail: every data part tagged with its
 * delegationId, in order, rendered with the same cards as the main thread.
 */
export function SubAgentActivity({
  agent,
  messages,
  busy,
}: {
  agent: AgentTabInfo;
  messages: UIMessage[];
  busy: boolean;
}) {
  const parts = partsForAgent(messages, agent.id);
  return (
    <box flexShrink={0} paddingLeft={1}>
      <box flexDirection="row" gap={1} paddingBottom={1} flexShrink={0}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="none">
          {glyph(agent)} {agent.name}
        </text>
        {agent.task ? (
          <text fg={theme.textMuted} wrapMode="none" truncate>
            — {agent.task}
          </text>
        ) : null}
      </box>
      {parts.length === 0 ? (
        <box paddingLeft={2}>
          <text fg={theme.textMuted}>{busy ? 'working…' : 'no activity recorded'}</text>
        </box>
      ) : (
        parts.map((p, i) => <DataPart key={i} part={p as never} busy={busy} />)
      )}
    </box>
  );
}
