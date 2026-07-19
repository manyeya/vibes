import type { TextareaRenderable } from '@opentui/core';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useRef, useState } from 'react';
import { syntaxStyle, theme } from '../theme';

export interface PlanReviewData {
  id: string;
  title: string;
  note?: string;
  problem?: string;
  solution?: string;
  phases?: Array<{ name: string; goal: string; steps?: string[] }>;
  milestones?: string[];
  risks?: string[];
  tasks: Array<{ id: string; title: string; status?: string; priority?: string }>;
}

const statusColor: Record<string, string> = {
  completed: theme.success,
  in_progress: theme.warning,
  blocked: theme.error,
  failed: theme.error,
  pending: theme.textMuted,
};

// The decision goes back as a plain user message (there is no reply endpoint) —
// the exact strings the web demo's PlanReviewForm sends, so the agent resumes
// the same way (approve → generate_tasks_from_plan; changes → revise + re-review).
const approveMessage = (note: string) =>
  `✅ Plan approved — generate the tasks and proceed.${note ? `\n\nNote: ${note}` : ''}`;
const changesMessage = (note: string) =>
  `✏️ Plan not approved — please revise it before proceeding.` +
  (note ? `\n\nRequested changes:\n${note}` : ' (See my notes, then send an updated plan for review.)');

function Label({ children }: { children: string }) {
  return (
    <text fg={theme.accent} attributes={TextAttributes.BOLD}>
      {children.toUpperCase()}
    </text>
  );
}

// Phases often already carry their own number ("1 · Research"); strip it so our
// index isn't doubled ("1. 1 · Research").
const stripLeadNum = (s: string) => s.replace(/^\s*(phase\s*)?\d+\s*[·.):\-–—]?\s*/i, '').trim() || s;

// Render prose fields as markdown (same renderer as the transcript) so lists,
// headings, bold and code look right instead of raw asterisks/backticks.
function Md({ content }: { content: string }) {
  return (
    <markdown
      syntaxStyle={syntaxStyle}
      tableOptions={{ style: 'grid' }}
      content={content.trim()}
      fg={theme.text}
      bg={theme.backgroundPanel}
    />
  );
}

/**
 * A plan the agent put up for sign-off (request_plan_review halts the run).
 * Pinned above the composer with Approve / Request changes and an optional
 * note; the decision is handed back as the next message. Mirrors the clar
 * (QuestionPrompt) idiom: ←→/tab select, enter confirm, e to add a note,
 * esc to dismiss and just type in the composer instead.
 */
export function PlanReview({
  data,
  active,
  onSubmit,
  onDismiss,
}: {
  data: PlanReviewData;
  active: boolean;
  /** Approving carries the mode to switch into (Claude Code-style); changes omit it. */
  onSubmit: (text: string, mode?: 'auto-edit' | 'manual') => void;
  onDismiss: () => void;
}) {
  const { height } = useTerminalDimensions();
  // Scale the plan body with the terminal — leave room for the header, note
  // editor and action row — instead of a fixed cap that clips tall plans.
  const bodyHeight = Math.max(12, Math.floor(height * 0.65));
  // 0 = approve → auto-edit, 1 = approve → manual, 2 = request changes.
  // Mirrors Claude Code's "auto-accept edits" / "manually approve" / "keep planning".
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const noteRef = useRef<TextareaRenderable>(null);

  const decide = (choice: number) => {
    const n = (editing ? noteRef.current?.plainText : note)?.trim() ?? '';
    if (choice === 2) return onSubmit(changesMessage(n));
    onSubmit(approveMessage(n), choice === 0 ? 'auto-edit' : 'manual');
  };

  useKeyboard((key) => {
    if (!active) return;
    if (editing) {
      if (key.name === 'escape') {
        setNote(noteRef.current?.plainText.trim() ?? '');
        setEditing(false);
      }
      return;
    }
    if (key.name === 'escape') return onDismiss();
    if (key.name === 'e') return setEditing(true);
    if (key.name === 'left') return setSelected((s) => Math.max(0, s - 1));
    if (key.name === 'right') return setSelected((s) => Math.min(2, s + 1));
    if (key.name === 'tab') return setSelected((s) => (s + 1) % 3);
    if (key.name === 'return') return decide(selected);
    if (key.name === '1') return decide(0);
    if (key.name === '2') return decide(1);
    if (key.name === '3') return decide(2);
  });

  return (
    <box backgroundColor={theme.backgroundPanel} flexShrink={0}>
      <box flexDirection="row" gap={1} paddingLeft={2} paddingRight={3} paddingTop={1}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="none">
          ▤ Plan review
        </text>
        <text fg={theme.text} flexGrow={1} wrapMode="none" truncate>
          {data.title}
        </text>
      </box>

      <scrollbox maxHeight={bodyHeight} paddingLeft={2} paddingRight={3} paddingTop={1}>
        {data.note ? <text fg={theme.textMuted} attributes={TextAttributes.ITALIC}>{data.note}</text> : null}
        {data.problem ? (
          <box paddingTop={data.note ? 1 : 0}>
            <Label>Problem</Label>
            <Md content={data.problem} />
          </box>
        ) : null}
        {data.solution ? (
          <box paddingTop={1}>
            <Label>Approach</Label>
            <Md content={data.solution} />
          </box>
        ) : null}
        {data.phases?.length ? (
          <box paddingTop={1}>
            <Label>Phases</Label>
            {data.phases.map((ph, i) => (
              <box key={i}>
                <text>
                  <span fg={theme.primary} attributes={TextAttributes.BOLD}>{`${i + 1}. `}</span>
                  <span fg={theme.text} attributes={TextAttributes.BOLD}>{stripLeadNum(ph.name)}</span>
                  {ph.goal ? <span fg={theme.textMuted}>{` — ${ph.goal}`}</span> : null}
                </text>
                {ph.steps?.length ? (
                  <box paddingLeft={3}>
                    {ph.steps.map((s, j) => (
                      <text key={j} fg={theme.textMuted}>
                        <span fg={theme.secondary}>· </span>
                        {s}
                      </text>
                    ))}
                  </box>
                ) : null}
              </box>
            ))}
          </box>
        ) : null}
        {data.tasks.length ? (
          <box paddingTop={1}>
            <Label>{`Tasks · ${data.tasks.length}`}</Label>
            {data.tasks.map((t) => (
              <box key={t.id} flexDirection="row" gap={1}>
                <text fg={statusColor[t.status ?? 'pending'] ?? theme.textMuted}>●</text>
                <text fg={theme.text} flexShrink={1} wrapMode="none" truncate>
                  {t.title}
                </text>
              </box>
            ))}
          </box>
        ) : null}
        {data.milestones?.length ? (
          <box paddingTop={1}>
            <Label>Milestones</Label>
            {data.milestones.map((m, i) => (
              <text key={i} fg={theme.text}>
                <span fg={theme.success}>◇ </span>
                {m}
              </text>
            ))}
          </box>
        ) : null}
        {data.risks?.length ? (
          <box paddingTop={1}>
            <Label>Risks</Label>
            {data.risks.map((m, i) => (
              <text key={i} fg={theme.text}>
                <span fg={theme.warning}>△ </span>
                {m}
              </text>
            ))}
          </box>
        ) : null}
      </scrollbox>

      {editing ? (
        <box paddingLeft={2} paddingRight={3} paddingTop={1}>
          <textarea
            ref={noteRef}
            focused
            minHeight={1}
            maxHeight={4}
            placeholder="Suggestions or requested changes…"
            placeholderColor={theme.textMuted}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.primary}
            backgroundColor={theme.backgroundPanel}
            focusedBackgroundColor={theme.backgroundPanel}
          />
        </box>
      ) : note ? (
        <box paddingLeft={2} paddingRight={3} paddingTop={1}>
          <text fg={theme.textMuted} wrapMode="none" truncate>
            note: {note}
          </text>
        </box>
      ) : null}

      <box flexDirection="row" gap={2} paddingLeft={2} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box paddingLeft={1} paddingRight={1} backgroundColor={selected === 0 ? theme.success : undefined}>
          <text fg={selected === 0 ? theme.background : theme.text}>✓ Approve · auto-edit</text>
        </box>
        <box paddingLeft={1} paddingRight={1} backgroundColor={selected === 1 ? theme.success : undefined}>
          <text fg={selected === 1 ? theme.background : theme.text}>✓ Approve · manual</text>
        </box>
        <box paddingLeft={1} paddingRight={1} backgroundColor={selected === 2 ? theme.warning : undefined}>
          <text fg={selected === 2 ? theme.background : theme.text}>✎ Request changes</text>
        </box>
        <box flexGrow={1} />
        <text fg={theme.text}>
          ←→ <span fg={theme.textMuted}>select</span>
        </text>
        <text fg={theme.text}>
          enter <span fg={theme.textMuted}>confirm</span>
        </text>
        <text fg={theme.text}>
          e <span fg={theme.textMuted}>note</span>
        </text>
        <text fg={theme.text}>
          esc <span fg={theme.textMuted}>dismiss</span>
        </text>
      </box>
    </box>
  );
}
