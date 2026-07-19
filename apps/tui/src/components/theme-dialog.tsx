import { RGBA, TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useRef, useState } from 'react';
import { activeTheme, applyTheme, theme, THEME_APPEARANCE, THEME_NAMES } from '../theme';
import { useScrollFollow } from './ui';

// Bearded theme picker. Filterable list; scrolling previews the theme live
// across the whole UI (persist:false), enter commits, esc reverts to whatever
// was active when the dialog opened.
export function ThemeDialog({ onClose }: { onClose: () => void }) {
  const { width, height } = useTerminalDimensions();
  const original = useRef(activeTheme());
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(() => Math.max(0, THEME_NAMES.indexOf(activeTheme())));

  const filtered = THEME_NAMES.filter((n) => n.toLowerCase().includes(filter.toLowerCase()));
  const sel = Math.min(selected, Math.max(0, filtered.length - 1));

  // Live preview: applying without persisting recolors the UI behind the dialog.
  const preview = (i: number) => {
    setSelected(i);
    const name = filtered[i];
    if (name) applyTheme(name, false);
  };
  const commit = () => {
    const name = filtered[sel];
    if (name) applyTheme(name, true);
    onClose();
  };
  const cancel = () => {
    applyTheme(original.current, false);
    onClose();
  };

  useKeyboard((key) => {
    if (key.name === 'escape') return cancel();
    if (key.name === 'up') preview(sel <= 0 ? filtered.length - 1 : sel - 1);
    if (key.name === 'down') preview(sel >= filtered.length - 1 ? 0 : sel + 1);
  });

  const listHeight = Math.max(6, Math.floor(height / 2) - 6);
  const scrollRef = useScrollFollow(sel, listHeight);

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={Math.floor(height / 5)}
      zIndex={3000}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box width={Math.min(64, width - 2)} backgroundColor={theme.backgroundPanel} paddingTop={1} paddingBottom={1}>
        <box paddingLeft={4} paddingRight={4}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Theme
            </text>
            <text fg={theme.textMuted}>{`${filtered.length}/${THEME_NAMES.length}`}</text>
          </box>
          <box paddingTop={1}>
            <input
              focused
              placeholder="Search Bearded themes"
              placeholderColor={theme.textMuted}
              cursorColor={theme.primary}
              backgroundColor={theme.backgroundPanel}
              focusedBackgroundColor={theme.backgroundPanel}
              focusedTextColor={theme.textMuted}
              onInput={(value) => {
                setFilter(value);
                preview(0);
              }}
              onSubmit={commit}
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
              {filtered.map((name, i) => {
                const active = i === sel;
                const current = name === original.current;
                const light = THEME_APPEARANCE[name] === 'light';
                return (
                  <box
                    key={name}
                    flexDirection="row"
                    paddingLeft={current ? 1 : 3}
                    paddingRight={3}
                    gap={1}
                    backgroundColor={active ? theme.primary : undefined}
                    onMouseOver={() => preview(i)}
                    onMouseDown={commit}
                  >
                    {current ? <text fg={active ? theme.background : theme.primary}>●</text> : null}
                    <text
                      flexGrow={1}
                      fg={active ? theme.background : theme.text}
                      attributes={active ? TextAttributes.BOLD : undefined}
                      wrapMode="none"
                      truncate
                    >
                      {name}
                    </text>
                    {light ? (
                      <text fg={active ? theme.background : theme.textMuted} wrapMode="none">
                        light
                      </text>
                    ) : null}
                  </box>
                );
              })}
            </scrollbox>
          )}
        </box>
        <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="row" gap={2}>
          <text fg={theme.text}>
            ↑↓ <span fg={theme.textMuted}>preview</span>
          </text>
          <text fg={theme.text}>
            enter <span fg={theme.textMuted}>apply</span>
          </text>
          <text fg={theme.text}>
            esc <span fg={theme.textMuted}>cancel</span>
          </text>
        </box>
      </box>
    </box>
  );
}
