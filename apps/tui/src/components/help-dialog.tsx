import { RGBA, TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { COMMANDS } from '../commands';
import { theme } from '../theme';

const KEYS: Array<[string, string]> = [
  ['return', 'send'],
  ['shift+return', 'newline'],
  ['esc', 'interrupt / close dialog'],
  ['ctrl+p', 'action menu (or right-click)'],
  ['ctrl+l', 'sessions'],
  ['ctrl+w', 'workspaces'],
  ['ctrl+o', 'model'],
  ['shift+←/→', 'cycle model'],
  ['ctrl+g', 'theme'],
  ['shift+tab', 'cycle mode (plan/manual/auto-edit/auto)'],
  ['ctrl+e', 'artifacts'],
  ['ctrl+t', 'switch agent view'],
  ['ctrl+n', 'new session'],
  ['f1', 'help'],
  ['ctrl+c', 'quit'],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const { width, height } = useTerminalDimensions();

  useKeyboard((key) => {
    if (key.name === 'escape') onClose();
  });

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={Math.max(1, Math.floor(height / 6))}
      zIndex={3000}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        width={Math.min(64, width - 2)}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={4}
        paddingRight={4}
      >
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Help
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        <box paddingTop={1}>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            Keys
          </text>
          {KEYS.map(([key, desc]) => (
            <box key={key} flexDirection="row">
              <text width={16} fg={theme.text}>
                {key}
              </text>
              <text fg={theme.textMuted}>{desc}</text>
            </box>
          ))}
        </box>
        <box paddingTop={1}>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            Commands
          </text>
          {COMMANDS.map((c) => (
            <box key={c.name} flexDirection="row">
              <text width={16} fg={theme.text}>
                /{c.name}
              </text>
              <text fg={theme.textMuted}>{c.desc}</text>
            </box>
          ))}
        </box>
      </box>
    </box>
  );
}
