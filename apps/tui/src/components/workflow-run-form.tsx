import type { TextareaRenderable } from '@opentui/core';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useRef, useState } from 'react';
import type { WorkflowInfo, WorkflowInput } from '../api';
import { theme } from '../theme';

// An input is picked from a fixed list (option widget) vs. free-typed (text).
function isOption(i: WorkflowInput): boolean {
  return i.type === 'boolean' || (!!i.enum && i.enum.length > 0);
}
function optionsFor(i: WorkflowInput): string[] {
  if (i.type === 'boolean') return ['Yes', 'No'];
  return i.enum ?? [];
}
function typeHint(i: WorkflowInput): string {
  if (i.type === 'array') return 'comma-separated';
  if (i.type === 'json') return 'JSON';
  if (i.type === 'number') return 'number';
  return '';
}

/**
 * Typed input form for running a saved workflow, pinned above the composer —
 * the TUI counterpart of the web demo's WorkflowRunForm. One tab per declared
 * input + a Confirm tab: option inputs (boolean / enum) are picked from a list;
 * everything else is free text edited in place (enter to edit, enter to commit).
 * Submits coerced inputs to the direct-run endpoint. Reuses the QuestionPrompt
 * interaction so it feels identical to the clarification form.
 */
export function WorkflowRunForm({
  workflow,
  active,
  onSubmit,
  onCancel,
}: {
  workflow: WorkflowInfo;
  active: boolean;
  onSubmit: (inputs: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const inputs = workflow.inputs ?? [];
  const tabCount = inputs.length + 1; // inputs… + Confirm

  const [tab, setTab] = useState(0);
  const [selected, setSelected] = useState(0); // highlighted option, for option inputs
  const [editing, setEditing] = useState(false); // typing into a text input
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const i of inputs) {
      if (i.default === undefined) continue;
      init[i.name] = i.type === 'boolean' ? (i.default ? 'Yes' : 'No') : String(i.default);
    }
    return init;
  });
  const editorRef = useRef<TextareaRenderable>(null);

  const confirm = tab === inputs.length;
  const current = confirm ? undefined : inputs[tab];
  const option = current ? isOption(current) : false;
  const opts = current ? optionsFor(current) : [];

  const set = (name: string, v: string) => setValues((p) => ({ ...p, [name]: v }));

  // Seed the editor with the field's current value when edit mode opens.
  useEffect(() => {
    if (!editing || !current) return;
    const ta = editorRef.current;
    if (!ta) return;
    ta.clear();
    const v = values[current.name];
    if (v) ta.insertText(v);
    ta.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const advance = () => {
    setTab((t) => Math.min(t + 1, inputs.length));
    setSelected(0);
  };

  const commit = () => {
    if (current) set(current.name, editorRef.current?.plainText.trim() ?? '');
    setEditing(false);
    advance();
  };

  // ── validation ──
  const filled = (i: WorkflowInput) => {
    const v = values[i.name];
    return v !== undefined && String(v).trim() !== '';
  };
  const jsonOk = (i: WorkflowInput) => {
    if (i.type !== 'json') return true;
    const v = values[i.name];
    if (!v || !v.trim()) return true;
    try { JSON.parse(v); return true; } catch { return false; }
  };
  const complete = inputs.every((i) => (!i.required || filled(i)) && jsonOk(i));

  // Coerce to the shape the run endpoint expects (matches the web form):
  // boolean → bool, array → string[], everything else → trimmed string.
  const coerce = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const i of inputs) {
      const raw = values[i.name];
      if (i.type === 'boolean') {
        if (raw === 'Yes' || raw === 'No') out[i.name] = raw === 'Yes';
      } else if (i.type === 'array') {
        const arr = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        if (arr.length) out[i.name] = arr;
      } else {
        const s = String(raw ?? '').trim();
        if (s) out[i.name] = s;
      }
    }
    return out;
  };

  const run = () => { if (complete) onSubmit(coerce()); };

  useKeyboard((key) => {
    if (!active) return;
    // While typing, let the editor own keys; esc just exits edit mode.
    if (editing) {
      if (key.name === 'escape') setEditing(false);
      return;
    }
    if (key.name === 'escape') return onCancel();
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
      if (key.name === 'return') run();
      return;
    }
    if (option) {
      if (key.name === 'up') setSelected((s) => (s - 1 + opts.length) % opts.length);
      if (key.name === 'down') setSelected((s) => (s + 1) % opts.length);
      if (key.name === 'return') { set(current!.name, opts[selected]!); advance(); }
      const num = Number(key.name);
      if (num >= 1 && num <= Math.min(opts.length, 9)) { set(current!.name, opts[num - 1]!); advance(); }
      return;
    }
    // text input: enter opens the editor
    if (key.name === 'return') setEditing(true);
  });

  return (
    <box backgroundColor={theme.backgroundPanel} flexShrink={0}>
      <box gap={1} paddingLeft={2} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box paddingLeft={1} flexDirection="row" gap={1}>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>⚡ {workflow.name}</text>
          {workflow.description ? <text fg={theme.textMuted}>{workflow.description}</text> : null}
        </box>

        {inputs.length > 0 ? (
          <box flexDirection="row" gap={1} paddingLeft={1}>
            {inputs.map((i, idx) => {
              const isActive = idx === tab;
              const isFilled = filled(i);
              return (
                <box
                  key={i.name}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={isActive ? theme.accent : theme.backgroundPanel}
                >
                  <text fg={isActive ? theme.background : isFilled ? theme.text : theme.textMuted}>
                    {i.name}
                    {i.required ? '*' : ''}
                  </text>
                </box>
              );
            })}
            <box paddingLeft={1} paddingRight={1} backgroundColor={confirm ? theme.accent : theme.backgroundPanel}>
              <text fg={confirm ? theme.background : theme.textMuted}>Run</text>
            </box>
          </box>
        ) : null}

        {!confirm && current ? (
          <box paddingLeft={1} gap={1}>
            <box>
              <text fg={theme.text}>
                {current.name}
                {current.required ? ' (required)' : ''}
                {typeHint(current) ? ` · ${typeHint(current)}` : ''}
              </text>
              {current.description ? <text fg={theme.textMuted}>{current.description}</text> : null}
            </box>

            {option ? (
              <box>
                {opts.map((opt, i) => {
                  const isSel = i === selected;
                  const picked = values[current.name] === opt;
                  return (
                    <box key={opt} flexDirection="row">
                      <box backgroundColor={isSel ? theme.backgroundElement : undefined} paddingRight={1}>
                        <text fg={isSel ? theme.secondary : theme.textMuted}>{`${i + 1}.`}</text>
                      </box>
                      <box backgroundColor={isSel ? theme.backgroundElement : undefined}>
                        <text fg={isSel ? theme.secondary : picked ? theme.success : theme.text}>{opt}</text>
                      </box>
                      {picked ? <text fg={theme.success}> ✓</text> : null}
                    </box>
                  );
                })}
              </box>
            ) : editing ? (
              <box paddingLeft={1}>
                <textarea
                  ref={editorRef}
                  focused
                  minHeight={1}
                  maxHeight={6}
                  placeholder={typeHint(current) || 'Type a value'}
                  placeholderColor={theme.textMuted}
                  textColor={theme.text}
                  focusedTextColor={theme.text}
                  cursorColor={theme.primary}
                  backgroundColor={theme.backgroundPanel}
                  focusedBackgroundColor={theme.backgroundPanel}
                  onSubmit={commit}
                  keyBindings={[{ name: 'return', action: 'submit' }]}
                />
              </box>
            ) : (
              <box paddingLeft={1}>
                <text fg={values[current.name] ? theme.text : theme.textMuted}>
                  {values[current.name] || 'enter to type a value'}
                </text>
              </box>
            )}
          </box>
        ) : null}

        {confirm ? (
          <box paddingLeft={1}>
            <text fg={theme.text}>{inputs.length ? 'Review' : `Run ${workflow.name}?`}</text>
            {inputs.map((i) => {
              const v = values[i.name] ?? '';
              const missing = i.required && !v.trim();
              const bad = !jsonOk(i);
              return (
                <text key={i.name}>
                  <span fg={theme.textMuted}>{`${i.name}: `}</span>
                  <span fg={missing || bad ? theme.error : v ? theme.text : theme.textMuted}>
                    {bad ? '(invalid JSON)' : v || (missing ? '(required)' : '(empty)')}
                  </span>
                </text>
              );
            })}
          </box>
        ) : null}
      </box>

      <box flexDirection="row" flexShrink={0} gap={2} paddingLeft={2} paddingRight={3} paddingBottom={1}>
        {inputs.length > 0 ? (
          <text fg={theme.text}>⇆ <span fg={theme.textMuted}>tab</span></text>
        ) : null}
        {!confirm && !option && !editing ? (
          <text fg={theme.text}>enter <span fg={theme.textMuted}>edit</span></text>
        ) : null}
        {!confirm && option ? (
          <text fg={theme.text}>↑↓ enter <span fg={theme.textMuted}>select</span></text>
        ) : null}
        {editing ? (
          <text fg={theme.text}>enter <span fg={theme.textMuted}>save</span></text>
        ) : null}
        {confirm ? (
          <text fg={complete ? theme.text : theme.textMuted}>enter <span fg={theme.textMuted}>run</span></text>
        ) : null}
        <text fg={theme.text}>esc <span fg={theme.textMuted}>cancel</span></text>
      </box>
    </box>
  );
}
