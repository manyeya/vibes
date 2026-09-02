import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { theme } from '../theme';

export interface ContextDecisionData {
  id: string;
  usedTokens: number;
  contextWindow: number;
  pct: number;
  reason: 'threshold' | 'compaction-failed';
  error?: string;
}

/** What the decision sends back on the request, alongside the message. */
export type ContextChoice = 'compact' | 'continue';

const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/**
 * Pinned above the composer when the run halts at the context threshold.
 *
 * Compaction is lossy and costs a model call that can fail, so it is never done
 * unprompted — the run stops here and waits. Mirrors the plan-review form: the
 * choice resumes the agent on the next request.
 */
export function ContextDecisionPrompt({
  data,
  active,
  onChoose,
  onDismiss,
}: {
  data: ContextDecisionData;
  active: boolean;
  onChoose: (choice: ContextChoice) => void;
  onDismiss: () => void;
}) {
  useKeyboard((key) => {
    if (!active) return;
    if (key.name === 'c') return onChoose('compact');
    if (key.name === 'k') return onChoose('continue');
    if (key.name === 'escape' || key.name === 's') return onDismiss();
  });

  const failed = data.reason === 'compaction-failed';

  return (
    <box
      flexShrink={0}
      border
      title={failed ? ' Compaction failed ' : ' Context filling up '}
      titleAlignment="left"
      borderColor={failed ? theme.error : theme.warning}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <text fg={theme.text}>
        {`Context ${data.pct}% full (${fmt(data.usedTokens)} / ${fmt(data.contextWindow)} tokens)`}
      </text>

      {failed ? (
        <box paddingTop={1}>
          <text fg={theme.error} wrapMode="word">
            {`Could not summarize: ${data.error ?? 'unknown error'}`}
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            Nothing was dropped — the full history is intact. Retry, or keep going without compacting.
          </text>
        </box>
      ) : (
        <box paddingTop={1}>
          <text fg={theme.textMuted} wrapMode="word">
            Compacting summarizes the oldest messages into a digest. It loses detail and costs a model call.
          </text>
        </box>
      )}

      <box paddingTop={1} flexDirection="row" gap={2}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          {failed ? '[c] retry compaction' : '[c] compact now'}
        </text>
        <text fg={theme.text}>[k] keep going</text>
        <text fg={theme.textMuted}>[s] stop</text>
      </box>
    </box>
  );
}
