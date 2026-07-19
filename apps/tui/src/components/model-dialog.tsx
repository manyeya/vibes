import { RGBA, TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useEffect, useState } from 'react';
import { getModels, shortModel, type ModelInfo } from '../api';
import { theme } from '../theme';
import { useScrollFollow } from './ui';

// opencode's model dialog (dialog-model.tsx pattern): filterable list grouped
// by provider, ● on the active model, enter to switch.
export function ModelDialog({
  currentId,
  onSelect,
  onClose,
}: {
  currentId?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { width, height } = useTerminalDimensions();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    getModels()
      .then(({ models }) => setModels(models))
      .catch(() => {});
  }, []);

  const filtered = models.filter((m) => m.id.toLowerCase().includes(filter.toLowerCase()));

  useKeyboard((key) => {
    if (key.name === 'escape') return onClose();
    if (key.name === 'up') setSelected((i) => (i <= 0 ? filtered.length - 1 : i - 1));
    if (key.name === 'down') setSelected((i) => (i >= filtered.length - 1 ? 0 : i + 1));
  });

  const rows: Array<{ kind: 'group'; label: string } | { kind: 'model'; model: ModelInfo; index: number }> = [];
  let lastGroup = '';
  filtered.forEach((m, index) => {
    const group = m.group ?? 'Other';
    if (group !== lastGroup) {
      rows.push({ kind: 'group', label: group });
      lastGroup = group;
    }
    rows.push({ kind: 'model', model: m, index });
  });

  const sel = Math.min(selected, Math.max(0, filtered.length - 1));

  let selectedLine = 0;
  for (let i = 0, acc = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.kind === 'model' && r.index === sel) { selectedLine = acc; break; }
    acc += r.kind === 'group' ? (i > 0 ? 2 : 1) : 1;
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
              Models
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
                if (target) onSelect(target.id);
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
                if (row.kind === 'group') {
                  return (
                    <box key={i} paddingLeft={3} paddingTop={i > 0 ? 1 : 0}>
                      <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                        {row.label}
                      </text>
                    </box>
                  );
                }
                const active = row.index === sel;
                const current = row.model.id === currentId;
                return (
                  <box
                    key={i}
                    flexDirection="row"
                    paddingLeft={current ? 1 : 3}
                    paddingRight={3}
                    gap={1}
                    backgroundColor={active ? theme.primary : undefined}
                    onMouseOver={() => setSelected(row.index)}
                    onMouseDown={() => onSelect(row.model.id)}
                  >
                    {current ? <text fg={active ? theme.background : theme.primary}>●</text> : null}
                    <text
                      flexGrow={1}
                      fg={active ? theme.background : theme.text}
                      attributes={active ? TextAttributes.BOLD : undefined}
                      wrapMode="none"
                      truncate
                    >
                      {shortModel(row.model.id)}
                    </text>
                  </box>
                );
              })}
            </scrollbox>
          )}
        </box>
        <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="row" gap={2}>
          <text fg={theme.text}>
            enter <span fg={theme.textMuted}>select</span>
          </text>
        </box>
      </box>
    </box>
  );
}
