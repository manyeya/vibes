import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import { getCheckpoints, rewindSession, type CheckpointInfo } from '../api';
import { theme } from '../theme';
import { useScrollFollow } from './ui';

/**
 * Restore the session to an earlier turn.
 *
 * Each entry is the prompt that started a turn, and the snapshot was taken
 * BEFORE it ran — so picking a turn returns the project to how it looked when
 * you sent it. Restores files and truncates the conversation together by
 * default, because a transcript that claims edits which no longer exist on disk
 * makes the agent redo or double-apply them.
 *
 * The restore snapshots the current state first, so this is reversible.
 */
export function RewindDialog({
  sessionId,
  messageCount,
  onDone,
  onClose,
}: {
  sessionId: string;
  /** Messages currently in the thread, used to map a turn back to a prefix. */
  messageCount: number;
  onDone: (result: { kept: number }) => void;
  onClose: () => void;
}) {
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<'both' | 'files' | 'conversation'>('both');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    getCheckpoints(sessionId)
      .then(setCheckpoints)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sessionId]);

  const run = async () => {
    const cp = checkpoints[selected];
    if (!cp || busy) return;
    setBusy(true);
    try {
      // Checkpoints are newest-first, so index N means "drop the N newest
      // turns" — two messages per turn (the prompt and the reply).
      const kept = Math.max(0, messageCount - selected * 2);
      await rewindSession(sessionId, cp.sha, { mode, messageCount: kept });
      onDone({ kept });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  useKeyboard((key) => {
    if (busy) return;
    if (key.name === 'escape') return onClose();
    if (key.name === 'up') return setSelected((i) => Math.max(0, i - 1));
    if (key.name === 'down') return setSelected((i) => Math.min(checkpoints.length - 1, i + 1));
    if (key.name === 'f') return setMode('files');
    if (key.name === 'c') return setMode('conversation');
    if (key.name === 'b') return setMode('both');
    if (key.name === 'return') return void run();
  });

  const scrollRef = useScrollFollow(selected, 10);

  return (
    <box
      position="absolute"
      left={4}
      right={4}
      top={2}
      bottom={2}
      border
      title=" Rewind "
      titleAlignment="left"
      borderColor={theme.borderActive}
      backgroundColor={theme.backgroundPanel}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
    >
      <text fg={theme.textMuted} wrapMode="word">
        Pick the turn to return to. The snapshot was taken before that turn ran.
      </text>

      <box paddingTop={1} flexGrow={1}>
        {error ? (
          <text fg={theme.error} wrapMode="word">{error}</text>
        ) : checkpoints.length === 0 ? (
          <text fg={theme.textMuted}>No restore points yet — they are created as you send prompts.</text>
        ) : (
          <scrollbox ref={scrollRef}>
            {checkpoints.map((cp, i) => (
              <box key={cp.id} flexDirection="row" gap={1}>
                <text fg={i === selected ? theme.accent : theme.textMuted} wrapMode="none">
                  {i === selected ? '❯' : ' '}
                </text>
                <text
                  fg={i === selected ? theme.text : theme.textMuted}
                  attributes={i === selected ? TextAttributes.BOLD : undefined}
                  wrapMode="none"
                  truncate
                  flexShrink={1}
                >
                  {cp.label || '(no prompt)'}
                </text>
              </box>
            ))}
          </scrollbox>
        )}
      </box>

      <box paddingTop={1} flexDirection="row" gap={2} flexShrink={0}>
        <text fg={mode === 'both' ? theme.accent : theme.textMuted}>[b] files + chat</text>
        <text fg={mode === 'files' ? theme.accent : theme.textMuted}>[f] files only</text>
        <text fg={mode === 'conversation' ? theme.accent : theme.textMuted}>[c] chat only</text>
      </box>
      <box flexShrink={0}>
        <text fg={theme.textMuted}>
          {busy ? 'restoring…' : '↑↓ choose · enter restore · esc cancel'}
        </text>
      </box>
    </box>
  );
}
