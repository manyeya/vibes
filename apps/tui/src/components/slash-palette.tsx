import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useMemo, useState } from 'react';
import { getAgents, getWorkflows, type AgentInfo, type WorkflowInfo } from '../api';
import { COMMANDS } from '../commands';
import { theme } from '../theme';
import { useScrollFollow } from './ui';

export type SlashResult =
  | { kind: 'command'; name: string }
  | { kind: 'agent'; name: string }
  | { kind: 'workflow'; workflow: WorkflowInfo };

type Group = 'Commands' | 'Agents' | 'Workflows';
interface Entry {
  group: Group;
  label: string;
  desc: string;
  result: SlashResult;
}

const GLYPH: Record<Group, string> = { Commands: '/', Agents: '◇', Workflows: '⚡' };

/**
 * The slash launcher: one searchable, grouped list of everything you can invoke
 * from the composer — commands, sub-agents, and saved workflows. Type to filter
 * (prefix matches rank first), ↑↓ to move, enter to pick, esc to dismiss. Its
 * own input holds focus so filtering never fights the composer.
 */
export function SlashPalette({
  onSelect,
  onClose,
}: {
  onSelect: (r: SlashResult) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    getAgents().then(setAgents).catch(() => {});
    getWorkflows().then(setWorkflows).catch(() => {});
  }, []);

  const entries = useMemo<Entry[]>(() => [
    ...COMMANDS.map((c): Entry => ({ group: 'Commands', label: `/${c.name}`, desc: c.desc, result: { kind: 'command', name: c.name } })),
    ...agents.map((a): Entry => ({ group: 'Agents', label: a.name, desc: a.description ?? 'Sub-agent', result: { kind: 'agent', name: a.name } })),
    ...workflows.map((w): Entry => ({ group: 'Workflows', label: w.name, desc: w.description ?? 'Saved workflow', result: { kind: 'workflow', workflow: w } })),
  ], [agents, workflows]);

  // Filter + rank: prefix hits first, then substring, then alphabetical; keep
  // the group order stable so headers stay grouped.
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const order: Group[] = ['Commands', 'Agents', 'Workflows'];
    return entries
      .map((e) => {
        const label = e.label.toLowerCase();
        const hay = `${label} ${e.desc.toLowerCase()}`;
        if (q && !hay.includes(q)) return null;
        const rank = !q ? 0 : label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
        return { e, rank };
      })
      .filter((x): x is { e: Entry; rank: number } => x !== null)
      .sort((a, b) =>
        order.indexOf(a.e.group) - order.indexOf(b.e.group) ||
        a.rank - b.rank ||
        a.e.label.localeCompare(b.e.label),
      )
      .map((x) => x.e);
  }, [entries, q]);

  const sel = Math.min(selected, Math.max(0, filtered.length - 1));

  useKeyboard((key) => {
    if (key.name === 'escape') return onClose();
    if (key.name === 'up') setSelected((i) => (i <= 0 ? filtered.length - 1 : i - 1));
    if (key.name === 'down') setSelected((i) => (i >= filtered.length - 1 ? 0 : i + 1));
  });

  // Rows with group headers interleaved.
  const rows: Array<{ kind: 'header'; label: Group } | { kind: 'entry'; entry: Entry; index: number }> = [];
  let last = '';
  filtered.forEach((e, index) => {
    if (e.group !== last) { rows.push({ kind: 'header', label: e.group }); last = e.group; }
    rows.push({ kind: 'entry', entry: e, index });
  });

  // Line offset of the selected entry (headers cost 2 lines except the first),
  // so the scrollbox can follow the ↑↓ selection.
  let selectedLine = 0;
  for (let i = 0, acc = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.kind === 'entry' && r.index === sel) { selectedLine = acc; break; }
    acc += r.kind === 'header' ? (i > 0 ? 2 : 1) : 1;
  }
  const scrollRef = useScrollFollow(selectedLine, 12);

  // In-flow panel above the composer (NOT a full-screen overlay: this renders
  // inside the Prompt, so absolute coords would resolve against the composer's
  // small box, not the screen — that's why the overlay version was invisible).
  return (
    <box
      width="100%"
      flexShrink={0}
      marginBottom={1}
      backgroundColor={theme.backgroundPanel}
      border
      borderStyle="rounded"
      borderColor={theme.borderActive}
      paddingTop={1}
      paddingBottom={1}
    >
      <box paddingLeft={2} paddingRight={2} flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Run…
        </text>
        <text fg={theme.textMuted}>↑↓ · enter · esc</text>
      </box>
      <box paddingLeft={2} paddingRight={2} paddingTop={1}>
        <input
          focused
          placeholder="Search commands, agents, workflows…"
          placeholderColor={theme.textMuted}
          cursorColor={theme.primary}
          backgroundColor={theme.backgroundPanel}
          focusedBackgroundColor={theme.backgroundPanel}
          focusedTextColor={theme.text}
          onInput={(value) => {
            setQuery(value);
            setSelected(0);
          }}
          onSubmit={() => {
            const e = filtered[sel];
            if (e) onSelect(e.result);
          }}
        />
      </box>

      <box paddingTop={1}>
        {filtered.length === 0 ? (
          <box paddingLeft={2}>
            <text fg={theme.textMuted}>No matches</text>
          </box>
        ) : (
          <scrollbox ref={scrollRef} maxHeight={12} paddingLeft={1} paddingRight={1}>
            {rows.map((row, i) => {
                if (row.kind === 'header') {
                  return (
                    <box key={`h-${i}`} paddingLeft={2} paddingTop={i > 0 ? 1 : 0} flexDirection="row" gap={1}>
                      <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                        {row.label}
                      </text>
                    </box>
                  );
                }
                const active = row.index === sel;
                return (
                  <box
                    key={`e-${i}`}
                    flexDirection="row"
                    gap={2}
                    paddingLeft={2}
                    paddingRight={2}
                    backgroundColor={active ? theme.primary : undefined}
                    onMouseOver={() => setSelected(row.index)}
                    onMouseDown={() => onSelect(row.entry.result)}
                  >
                    <text fg={active ? theme.background : theme.textMuted} wrapMode="none">
                      {GLYPH[row.entry.group]}
                    </text>
                    <text
                      fg={active ? theme.background : theme.text}
                      attributes={active ? TextAttributes.BOLD : undefined}
                      wrapMode="none"
                    >
                      {row.entry.label}
                    </text>
                    <text fg={active ? theme.background : theme.textMuted} wrapMode="none" truncate flexGrow={1}>
                      {row.entry.desc}
                    </text>
                  </box>
                );
              })}
            </scrollbox>
          )}
      </box>
    </box>
  );
}
