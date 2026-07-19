import type { GitInfo, WorkspaceInfo } from '../api';
import { modeStyle } from '../modes';
import { ctxColor, theme } from '../theme';

/**
 * The status bar. Left = where you are (workspace + git branch/dirty); right =
 * live state (context-window fullness, connection). Actions live in the F1 help
 * and the Ctrl+P / right-click menu — a status bar shows state, not shortcuts.
 * Convention borrowed from helix/lazygit/k9s: identity on the left, at-a-glance
 * telemetry on the right.
 */
export function Footer({
  connected,
  workspace,
  git,
  ctxPct,
  mode,
}: {
  connected: boolean;
  workspace?: WorkspaceInfo;
  git?: GitInfo | null;
  ctxPct?: number | null;
  mode?: string;
}) {
  const m = mode ? modeStyle(mode) : null;
  return (
    <box flexDirection="row" justifyContent="space-between" gap={2} flexShrink={0} height={1}>
      <box flexDirection="row" gap={2} flexShrink={1} minWidth={0}>
        {workspace ? (
          <box flexDirection="row" gap={1} flexShrink={1} minWidth={0}>
            <text fg={theme.accent} wrapMode="none">
              ◆
            </text>
            <text fg={theme.text} wrapMode="none" truncate>
              {workspace.name}
            </text>
          </box>
        ) : (
          <text fg={theme.textMuted} wrapMode="none">
            no workspace
          </text>
        )}
        {git ? (
          <box flexDirection="row" gap={1} flexShrink={0}>
            <text fg={theme.textMuted} wrapMode="none">
              ⎇
            </text>
            <text fg={theme.text} wrapMode="none">
              {git.branch}
            </text>
            {git.dirty ? (
              <text fg={theme.warning} wrapMode="none">
                *
              </text>
            ) : null}
          </box>
        ) : null}
      </box>
      <box gap={2} flexDirection="row" flexShrink={0}>
        {m ? (
          <text fg={m.color} wrapMode="none">
            {m.glyph} {m.label}
          </text>
        ) : null}
        {ctxPct != null ? (
          <text fg={ctxColor(ctxPct)} wrapMode="none">
            {ctxPct}% ctx
          </text>
        ) : null}
        <text fg={theme.text}>
          <span fg={connected ? theme.success : theme.error}>•</span>{' '}
          {connected ? 'connected' : 'disconnected'}
        </text>
      </box>
    </box>
  );
}
