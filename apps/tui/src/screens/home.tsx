import { useTerminalDimensions } from '@opentui/react';
import { shortModel, type GitInfo } from '../api';
import { Footer } from '../components/footer';
import { Logo } from '../components/logo';
import { Prompt } from '../components/prompt';
import { theme } from '../theme';

// opencode home: logo + prompt centered vertically, footer pinned at the
// bottom. Submitting here creates a session and jumps into it.
export function Home({
  connected,
  model,
  mode,
  cwd,
  git,
  focused,
  onSubmit,
}: {
  connected: boolean;
  model?: string;
  mode?: string;
  cwd?: string;
  git?: GitInfo | null;
  focused: boolean;
  onSubmit: (text: string) => void;
}) {
  const { width } = useTerminalDimensions();
  const promptWidth = Math.max(Math.min(75, width - 4), Math.floor(width * 0.7));

  return (
    <box flexGrow={1} backgroundColor={theme.background}>
      <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} minHeight={0} />
        <box flexShrink={0}>
          <Logo />
        </box>
        <box height={1} />
        <box width="100%" maxWidth={promptWidth} flexShrink={0} alignItems="center">
          {cwd ? null : (
            <text fg={theme.textMuted} wrapMode="none" truncate>
              no project directory — start vibes inside a repo
            </text>
          )}
        </box>
        <box width="100%" maxWidth={promptWidth} paddingTop={1} flexShrink={0}>
          <Prompt
            placeholder="Fix a TODO in the codebase"
            focused={focused}
            busy={false}
            statusMsg=""
            model={shortModel(model)}
            leftLabel=""
            onSubmit={onSubmit}
          />
        </box>
        <box flexGrow={1} minHeight={0} />
      </box>
      <box width="100%" flexShrink={0} paddingLeft={2} paddingRight={2}>
        <Footer connected={connected} cwd={cwd} git={git} mode={mode} />
      </box>
    </box>
  );
}
