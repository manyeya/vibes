import { RGBA, TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useEffect, useState } from 'react';
import { deleteSession, listSessions, type SessionInfo } from '../api';
import { theme } from '../theme';
import { useScrollFollow } from './ui';

export function sessionTitle(s: SessionInfo): string {
  return (s.metadata?.title as string | undefined) ?? s.summary ?? s.id;
}

function category(s: SessionInfo): string {
  if (!s.updatedAt) return 'Older';
  const updated = new Date(s.updatedAt);
  return updated.toDateString() === new Date().toDateString() ? 'Today' : updated.toDateString();
}

// opencode session switcher: dimmed backdrop, centered panel at the top
// quarter, title + esc, filter input, date-grouped rows, ● on the current
// session, selected row on primary.
export function SessionDialog({
  currentId,
  workspaceId,
  onSelect,
  onClose,
}: {
  currentId?: string;
  workspaceId?: string;
  onSelect: (session: SessionInfo) => void;
  onClose: () => void;
}) {
  const { width, height } = useTerminalDimensions();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(0);

  const refresh = () =>
    listSessions(workspaceId)
      .then((all) =>
        setSessions([...all].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))),
      )
      .catch(() => {});

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = sessions.filter((s) =>
    sessionTitle(s).toLowerCase().includes(filter.toLowerCase()),
  );

  useKeyboard((key) => {
    if (key.name === 'escape') return onClose();
    if (key.name === 'up') setSelected((i) => (i <= 0 ? filtered.length - 1 : i - 1));
    if (key.name === 'down') setSelected((i) => (i >= filtered.length - 1 ? 0 : i + 1));
    if (key.name === 'd' && key.ctrl) {
      const target = filtered[Math.min(selected, filtered.length - 1)];
      if (target) {
        deleteSession(target.id)
          .then(refresh)
          .catch(() => {});
      }
    }
  });

  const rows: Array<{ kind: 'category'; label: string } | { kind: 'session'; session: SessionInfo; index: number }> =
    [];
  let lastCategory = '';
  filtered.forEach((s, index) => {
    const cat = category(s);
    if (cat !== lastCategory) {
      rows.push({ kind: 'category', label: cat });
      lastCategory = cat;
    }
    rows.push({ kind: 'session', session: s, index });
  });

  const sel = Math.min(selected, Math.max(0, filtered.length - 1));

  let selectedLine = 0;
  for (let i = 0, acc = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.kind === 'session' && r.index === sel) { selectedLine = acc; break; }
    acc += r.kind === 'category' ? (i > 0 ? 2 : 1) : 1;
  }
  const listHeight = Math.max(4, Math.floor(height / 2) - 6);
  const scrollRef = useScrollFollow(selectedLine, listHeight);

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={Math.floor(height / 4)}
      zIndex={3000}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box width={Math.min(64, width - 2)} backgroundColor={theme.backgroundPanel} paddingTop={1} paddingBottom={1}>
        <box paddingLeft={4} paddingRight={4}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Sessions
            </text>
            <text fg={theme.textMuted}>esc</text>
          </box>
          <box paddingTop={1}>
            <input
              focused
              placeholder="Search"
              placeholderColor={theme.textMuted}
              cursorColor={theme.primary}
              backgroundColor={theme.backgroundPanel}
              focusedBackgroundColor={theme.backgroundPanel}
              focusedTextColor={theme.textMuted}
              onInput={(value) => {
                setFilter(value);
                setSelected(0);
              }}
              onSubmit={() => {
                const target = filtered[sel];
                if (target) onSelect(target);
              }}
            />
          </box>
        </box>
        <box paddingTop={1}>
          {filtered.length === 0 ? (
            <box paddingLeft={4}>
              <text fg={theme.textMuted}>No results found</text>
            </box>
          ) : (
            <scrollbox ref={scrollRef} maxHeight={listHeight} paddingLeft={1} paddingRight={1}>
              {rows.map((row, i) => {
                if (row.kind === 'category') {
                  return (
                    <box key={i} paddingLeft={3} paddingTop={i > 0 ? 1 : 0}>
                      <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                        {row.label}
                      </text>
                    </box>
                  );
                }
                const active = row.index === sel;
                const current = row.session.id === currentId;
                return (
                  <box
                    key={i}
                    flexDirection="row"
                    paddingLeft={current ? 1 : 3}
                    paddingRight={3}
                    gap={1}
                    backgroundColor={active ? theme.primary : undefined}
                    onMouseOver={() => setSelected(row.index)}
                    onMouseDown={() => onSelect(row.session)}
                  >
                    {current ? <text fg={active ? theme.background : theme.primary}>●</text> : null}
                    <text
                      flexGrow={1}
                      fg={active ? theme.background : theme.text}
                      attributes={active ? TextAttributes.BOLD : undefined}
                      wrapMode="none"
                      truncate
                    >
                      {sessionTitle(row.session)}
                    </text>
                    <text flexShrink={0} fg={active ? theme.background : theme.textMuted}>
                      {`${row.session.messageCount ?? 0} msgs`}
                    </text>
                  </box>
                );
              })}
            </scrollbox>
          )}
        </box>
        <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="row" gap={2}>
          <text fg={theme.text}>
            enter <span fg={theme.textMuted}>open</span>
          </text>
          <text fg={theme.text}>
            ctrl+d <span fg={theme.textMuted}>delete</span>
          </text>
        </box>
      </box>
    </box>
  );
}
