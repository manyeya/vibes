import type { TextareaRenderable } from '@opentui/core';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useRef, useState } from 'react';
import { theme } from '../theme';

export interface ClarificationQuestion {
  id: string;
  question: string;
  description?: string;
  kind: 'single' | 'multi' | 'text' | 'boolean' | 'number';
  options?: string[];
  allowCustom?: boolean;
  placeholder?: string;
}

export interface ClarificationData {
  id: string;
  title?: string;
  questions: ClarificationQuestion[];
}

function optionsFor(q: ClarificationQuestion): string[] {
  if (q.kind === 'boolean') return ['Yes', 'No'];
  return q.options ?? [];
}

function hasCustom(q: ClarificationQuestion): boolean {
  if (q.kind === 'boolean') return false;
  if (q.kind === 'text' || q.kind === 'number') return true;
  return q.allowCustom !== false;
}

// The answer goes back as a plain user message (there is no reply endpoint);
// this is the exact format the web demo's ClarificationForm sends.
function formatAnswers(questions: ClarificationQuestion[], answers: string[][]): string {
  const lines = questions.map((q, i) => {
    const answer = answers[i]?.length ? answers[i]!.join(', ') : '(no answer)';
    return `- ${q.question}\n  → ${answer}`;
  });
  return `Here are my answers:\n${lines.join('\n')}`;
}

// Port of opencode's QuestionPrompt (routes/session/question.tsx): pinned
// above the composer, one question per tab + Confirm tab, ↑↓/1-9 + enter to
// answer, esc to dismiss and just type in the composer instead.
export function QuestionPrompt({
  data,
  active,
  onSubmit,
  onDismiss,
}: {
  data: ClarificationData;
  active: boolean;
  onSubmit: (text: string) => void;
  onDismiss: () => void;
}) {
  const questions = data.questions;
  const single =
    questions.length === 1 && questions[0]!.kind !== 'multi';
  const tabCount = single ? 1 : questions.length + 1;

  const [tab, setTab] = useState(0);
  const [selected, setSelected] = useState(0);
  const [answers, setAnswers] = useState<string[][]>(() => questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(() => questions.map(() => ''));
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<TextareaRenderable>(null);

  const confirm = !single && tab === questions.length;
  const question = confirm ? undefined : questions[tab];
  const options = question ? optionsFor(question) : [];
  const custom_ = question ? hasCustom(question) : false;
  const total = options.length + (custom_ ? 1 : 0);
  const onOther = custom_ && selected === options.length;
  const multi = question?.kind === 'multi';

  const submitAll = (final: string[][]) => onSubmit(formatAnswers(questions, final));

  const setAnswer = (index: number, value: string[]) =>
    setAnswers((prev) => prev.map((a, i) => (i === index ? value : a)));

  const advance = () => {
    setTab((t) => t + 1);
    setSelected(0);
  };

  const pick = (value: string) => {
    const next = answers.map((a, i) => (i === tab ? [value] : a));
    setAnswers(next);
    if (single) {
      submitAll(next);
      return;
    }
    advance();
  };

  const toggle = (value: string) => {
    const existing = answers[tab] ?? [];
    setAnswer(tab, existing.includes(value) ? existing.filter((x) => x !== value) : [...existing, value]);
  };

  const selectOption = () => {
    if (onOther) {
      setEditing(true);
      return;
    }
    const opt = options[selected];
    if (!opt) return;
    if (multi) return toggle(opt);
    pick(opt);
  };

  const submitCustom = () => {
    const text = editorRef.current?.plainText.trim() ?? '';
    setEditing(false);
    if (!text) return;
    setCustom((prev) => prev.map((c, i) => (i === tab ? text : c)));
    if (multi) {
      const prev = custom[tab];
      const existing = (answers[tab] ?? []).filter((x) => x !== prev);
      setAnswer(tab, [...existing, text]);
      return;
    }
    pick(text);
  };

  useKeyboard((key) => {
    if (!active) return;
    if (editing) {
      if (key.name === 'escape') setEditing(false);
      return;
    }
    if (key.name === 'escape') return onDismiss();
    if (key.name === 'tab' || key.name === 'right') {
      setTab((t) => (t + (key.shift ? -1 : 1) + tabCount) % tabCount);
      setSelected(0);
      return;
    }
    if (key.name === 'left') {
      setTab((t) => (t - 1 + tabCount) % tabCount);
      setSelected(0);
      return;
    }
    if (confirm) {
      if (key.name === 'return') submitAll(answers);
      return;
    }
    if (key.name === 'up') setSelected((s) => (s - 1 + total) % total);
    if (key.name === 'down') setSelected((s) => (s + 1) % total);
    if (key.name === 'return') selectOption();
    const num = Number(key.name);
    if (num >= 1 && num <= Math.min(total, 9)) {
      setSelected(num - 1);
      if (num - 1 < options.length || custom_) {
        if (num - 1 === options.length) setEditing(true);
        else if (multi) toggle(options[num - 1]!);
        else pick(options[num - 1]!);
      }
    }
  });

  return (
    <box backgroundColor={theme.backgroundPanel} flexShrink={0}>
      <box gap={1} paddingLeft={2} paddingRight={3} paddingTop={1} paddingBottom={1}>
        {data.title ? (
          <box paddingLeft={1}>
            <text fg={theme.accent} attributes={TextAttributes.BOLD}>
              {data.title}
            </text>
          </box>
        ) : null}

        {!single ? (
          <box flexDirection="row" gap={1} paddingLeft={1}>
            {questions.map((q, i) => {
              const isActive = i === tab;
              const isAnswered = (answers[i]?.length ?? 0) > 0;
              return (
                <box
                  key={q.id}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={isActive ? theme.accent : theme.backgroundPanel}
                >
                  <text fg={isActive ? theme.background : isAnswered ? theme.text : theme.textMuted}>
                    {`Q${i + 1}`}
                  </text>
                </box>
              );
            })}
            <box paddingLeft={1} paddingRight={1} backgroundColor={confirm ? theme.accent : theme.backgroundPanel}>
              <text fg={confirm ? theme.background : theme.textMuted}>Confirm</text>
            </box>
          </box>
        ) : null}

        {!confirm && question ? (
          <box paddingLeft={1} gap={1}>
            <box>
              <text fg={theme.text}>
                {question.question}
                {multi ? ' (select all that apply)' : ''}
              </text>
              {question.description ? <text fg={theme.textMuted}>{question.description}</text> : null}
            </box>
            <box>
              {options.map((opt, i) => {
                const active = i === selected;
                const picked = answers[tab]?.includes(opt) ?? false;
                return (
                  <box key={i} flexDirection="row">
                    <box backgroundColor={active ? theme.backgroundElement : undefined} paddingRight={1}>
                      <text fg={active ? theme.secondary : theme.textMuted}>{`${i + 1}.`}</text>
                    </box>
                    <box backgroundColor={active ? theme.backgroundElement : undefined}>
                      <text fg={active ? theme.secondary : picked ? theme.success : theme.text}>
                        {multi ? `[${picked ? '✓' : ' '}] ${opt}` : opt}
                      </text>
                    </box>
                    {!multi && picked ? <text fg={theme.success}> ✓</text> : null}
                  </box>
                );
              })}
              {custom_ ? (
                <box>
                  <box flexDirection="row">
                    <box backgroundColor={onOther ? theme.backgroundElement : undefined} paddingRight={1}>
                      <text fg={onOther ? theme.secondary : theme.textMuted}>{`${options.length + 1}.`}</text>
                    </box>
                    <box backgroundColor={onOther ? theme.backgroundElement : undefined}>
                      <text fg={onOther ? theme.secondary : theme.text}>
                        {options.length ? 'Type your own answer' : (question.placeholder ?? 'Type your answer')}
                      </text>
                    </box>
                  </box>
                  {editing ? (
                    <box paddingLeft={3}>
                      <textarea
                        ref={editorRef}
                        focused
                        minHeight={1}
                        maxHeight={6}
                        placeholder={question.placeholder ?? 'Type your answer'}
                        placeholderColor={theme.textMuted}
                        textColor={theme.text}
                        focusedTextColor={theme.text}
                        cursorColor={theme.primary}
                        backgroundColor={theme.backgroundPanel}
                        focusedBackgroundColor={theme.backgroundPanel}
                        onSubmit={submitCustom}
                        keyBindings={[{ name: 'return', action: 'submit' }]}
                      />
                    </box>
                  ) : custom[tab] ? (
                    <box paddingLeft={3}>
                      <text fg={theme.textMuted}>{custom[tab]}</text>
                    </box>
                  ) : null}
                </box>
              ) : null}
            </box>
          </box>
        ) : null}

        {confirm ? (
          <box paddingLeft={1}>
            <text fg={theme.text}>Review</text>
            {questions.map((q, i) => {
              const value = answers[i]?.join(', ') ?? '';
              return (
                <text key={q.id}>
                  <span fg={theme.textMuted}>{`Q${i + 1}: `}</span>
                  <span fg={value ? theme.text : theme.error}>{value || '(not answered)'}</span>
                </text>
              );
            })}
          </box>
        ) : null}
      </box>
      <box flexDirection="row" flexShrink={0} gap={2} paddingLeft={2} paddingRight={3} paddingBottom={1}>
        {!single ? (
          <text fg={theme.text}>
            ⇆ <span fg={theme.textMuted}>tab</span>
          </text>
        ) : null}
        {!confirm ? (
          <text fg={theme.text}>
            ↑↓ <span fg={theme.textMuted}>select</span>
          </text>
        ) : null}
        <text fg={theme.text}>
          enter{' '}
          <span fg={theme.textMuted}>{confirm ? 'submit' : multi ? 'toggle' : single ? 'submit' : 'confirm'}</span>
        </text>
        <text fg={theme.text}>
          esc <span fg={theme.textMuted}>dismiss</span>
        </text>
      </box>
    </box>
  );
}
