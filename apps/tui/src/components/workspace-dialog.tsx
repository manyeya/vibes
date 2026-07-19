import { RGBA, TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useEffect, useState } from 'react';
import { createWorkspace, listWorkspaces, type WorkspaceInfo } from '../api';
import { theme } from '../theme';
import { useScrollFollow } from './ui';

/**
 * Workspace switcher: open a folder by path (Codex-style) or pick an existing
 * workspace. A session belongs to a workspace, so its sub-agents operate in
 * that project directory instead of an empty per-session dir.
 *
 * Input non-empty → Enter opens it as a folder. Input empty → Enter selects the
 * highlighted workspace; up/down navigate the list.
 */
export function WorkspaceDialog({
  currentId,
  onSelect,
  onClose,
}: {
  currentId?: string;
  onSelect: (workspace: WorkspaceInfo) => void;
  onClose: () => void;
}) {
  const { width, height } = useTerminalDimensions();
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [path, setPath] = useState('');
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    listWorkspaces()
      .then((all) => setWorkspaces([...all].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))))
      .catch(() => {});
  }, []);

  const openFolder = () => {
    const rootDir = path.trim();
    if (!rootDir) return;
    createWorkspace({ rootDir })
      .then(onSelect)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'could not open folder'));
  };

  const submit = () => {
    if (path.trim()) return openFolder();
    const target = workspaces[Math.min(selected, workspaces.length - 1)];
    if (target) onSelect(target);
  };

  useKeyboard((key) => {
    if (key.name === 'escape') return onClose();
    if (key.name === 'up') setSelected((i) => (i <= 0 ? workspaces.length - 1 : i - 1));
    if (key.name === 'down') setSelected((i) => (i >= workspaces.length - 1 ? 0 : i + 1));
  });

  const sel = Math.min(selected, Math.max(0, workspaces.length - 1));
  // Each workspace row is two lines (name + path).
  const listHeight = Math.max(4, Math.floor(height / 2) - 6);
  const scrollRef = useScrollFollow(sel * 2, listHeight);

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
      <box width={Math.min(72, width - 2)} backgroundColor={theme.backgroundPanel} paddingTop={1} paddingBottom={1}>
        <box paddingLeft={4} paddingRight={4}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Workspaces
            </text>
            <text fg={theme.textMuted}>esc</text>
          </box>
          <box paddingTop={1}>
            <input
              focused
              placeholder="Open a folder — type an absolute path…"
              placeholderColor={theme.textMuted}
              cursorColor={theme.primary}
              backgroundColor={theme.backgroundPanel}
              focusedBackgroundColor={theme.backgroundPanel}
              focusedTextColor={theme.text}
              onInput={(value) => {
                setPath(value);
                setError('');
              }}
              onSubmit={submit}
            />
          </box>
          {error ? (
            <box paddingTop={1}>
              <text fg={theme.error}>⚠ {error}</text>
            </box>
          ) : null}
        </box>

        <box paddingTop={1}>
          {workspaces.length === 0 ? (
            <box paddingLeft={4}>
              <text fg={theme.textMuted}>No workspaces yet — type a folder path above and press enter.</text>
            </box>
          ) : (
            <scrollbox ref={scrollRef} maxHeight={listHeight} paddingLeft={1} paddingRight={1}>
              {workspaces.map((w, index) => {
                const active = index === sel && !path.trim();
                const current = w.id === currentId;
                return (
                  <box
                    key={w.id}
                    flexDirection="row"
                    paddingLeft={current ? 1 : 3}
                    paddingRight={3}
                    gap={1}
                    backgroundColor={active ? theme.primary : undefined}
                    onMouseOver={() => setSelected(index)}
                    onMouseDown={() => onSelect(w)}
                  >
                    {current ? <text fg={active ? theme.background : theme.primary}>●</text> : null}
                    <box flexGrow={1} minWidth={0}>
                      <text
                        fg={active ? theme.background : theme.text}
                        attributes={active ? TextAttributes.BOLD : undefined}
                        wrapMode="none"
                        truncate
                      >
                        {w.name}
                      </text>
                      <text fg={active ? theme.background : theme.textMuted} wrapMode="none" truncate>
                        {w.rootDir}
                      </text>
                    </box>
                    <text flexShrink={0} fg={active ? theme.background : theme.textMuted}>
                      {`${w.sessionCount ?? 0} sess`}
                    </text>
                  </box>
                );
              })}
            </scrollbox>
          )}
        </box>

        <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="row" gap={2}>
          <text fg={theme.text}>
            enter <span fg={theme.textMuted}>{path.trim() ? 'open folder' : 'select'}</span>
          </text>
          <text fg={theme.text}>
            ↑↓ <span fg={theme.textMuted}>navigate</span>
          </text>
        </box>
      </box>
    </box>
  );
}
