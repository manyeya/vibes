import { TextAttributes } from '@opentui/core';
import { theme } from '../theme';

export interface Task {
  id: string;
  title: string;
  status: string;
}

const GLYPH: Record<string, string> = {
  completed: '✔',
  in_progress: '◐',
  failed: '✗',
  blocked: '⊘',
  pending: '○',
};

const COLOR = (s: string): string =>
  s === 'completed'
    ? theme.textMuted
    : s === 'in_progress'
      ? theme.warning
      : s === 'failed'
        ? theme.error
        : s === 'blocked'
          ? theme.textMuted
          : theme.text;

/**
 * The live task list, pinned above the composer (not scrolling away in the
 * transcript). Derived from the task_graph / task_update stream, it updates in
 * place: done items dim + strike, the active one is highlighted, the header
 * tracks progress. Non-interactive — display only.
 */
export function TaskPanel({ tasks, busy }: { tasks: Task[]; busy: boolean }) {
  const done = tasks.filter((t) => t.status === 'completed').length;
  const active = tasks.find((t) => t.status === 'in_progress');
  // Show only while the agent is working AND there's still incomplete work.
  // Once everything's done (or the turn ends) it's gone — and it won't come back
  // on the next message just because the session still holds the finished list.
  if (!busy || tasks.length === 0 || done === tasks.length) return null;

  return (
    <box
      flexShrink={0}
      border={['top']}
      title={` Tasks · ${done}/${tasks.length} `}
      titleAlignment="left"
      borderColor={theme.borderSubtle}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
    >
      <scrollbox maxHeight={9} stickyScroll stickyStart="bottom">
        {tasks.map((t) => {
          const running = t.status === 'in_progress';
          const complete = t.status === 'completed';
          return (
            <box key={t.id} flexDirection="row" gap={1}>
              <text fg={COLOR(t.status)} wrapMode="none">
                {GLYPH[t.status] ?? '○'}
              </text>
              <text
                fg={COLOR(t.status)}
                attributes={complete ? TextAttributes.STRIKETHROUGH : running ? TextAttributes.BOLD : undefined}
                flexShrink={1}
                wrapMode="none"
                truncate
              >
                {t.title}
              </text>
            </box>
          );
        })}
      </scrollbox>
      {active ? (
        <box paddingTop={1}>
          <text fg={theme.textMuted} wrapMode="none" truncate>
            → {active.title}
          </text>
        </box>
      ) : null}
    </box>
  );
}
