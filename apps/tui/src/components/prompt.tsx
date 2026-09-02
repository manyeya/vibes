import type { TextareaRenderable } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useRef, useState } from 'react';
import { fmtElapsed, fmtTokens, theme } from '../theme';
import { SlashPalette, type SlashResult } from './slash-palette';
import { Spinner } from './spinner';

// Flat composer: input on a backgroundElement panel with the meta row
// (agent · model) inside, then a status row: busy → spinner + status +
// "esc interrupt"; idle → left label + usage/hints on the right.
export function Prompt({
  placeholder,
  busy,
  statusMsg,
  model,
  leftLabel,
  tokens,
  onSubmit,
  focused = true,
  inputRef,
}: {
  placeholder: string;
  busy: boolean;
  statusMsg: string;
  model?: string;
  leftLabel: string;
  /** Estimated tokens streamed so far this turn (null when idle). */
  tokens?: number | null;
  onSubmit: (text: string) => void;
  focused?: boolean;
  /** Lets the parent reach the textarea (e.g. to restore text on failure). */
  inputRef?: React.RefObject<TextareaRenderable | null>;
}) {
  const localRef = useRef<TextareaRenderable>(null);
  const ref = inputRef ?? localRef;

  // Claude Code-style turn clock: ticks once a second while busy.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const [slashOpen, setSlashOpen] = useState(false);
  // A selected sub-agent shown as a chip in the composer; the message you type
  const [target, setTarget] = useState<{ kind: 'agent'; name: string } | null>(null);

  const submit = () => {
    const ta = ref.current;
    // No busy guard: the parent decides whether to queue or send.
    if (!ta) return;
    const text = ta.plainText.trim();
    if (!text && !target) return;
    // clear() is deterministic; the selectAll()+deleteSelection() dance
    // silently no-ops when no selection state exists yet.
    ta.clear();
    const composed = target
      ? `Ask the ${target.name} sub-agent to ${text || 'proceed with the task.'}`
      : text;
    setTarget(null);
    onSubmit(composed);
  };

  // Typing '/' at the start launches the slash palette. The '/' is a trigger
  // (consumed), so the palette owns the query and the composer stays out of the
  // way until you pick something.
  const onContent = () => {
    const d = ref.current?.plainText ?? '';
    if (!slashOpen && !busy && d.trimStart().startsWith('/')) {
      setSlashOpen(true);
      ref.current?.clear();
    }
  };

  const closeSlash = () => {
    setSlashOpen(false);
    ref.current?.focus?.();
  };

  const onSlashSelect = (r: SlashResult) => {
    setSlashOpen(false);
    if (r.kind === 'command') {
      onSubmit(`/${r.name}`); // parent parses → runs the app action
      return;
    }
    // Agent → attach as a chip; the composer stays for the message.
    setTarget({ kind: 'agent', name: r.name });
    ref.current?.focus?.();
  };

  // Backspace on an empty composer removes the target chip (Slack-style).
  useKeyboard((key) => {
    if (target && !slashOpen && key.name === 'backspace' && !(ref.current?.plainText ?? '').length) {
      setTarget(null);
    }
  });

  return (
    <box width="100%"  flexShrink={0}>
      {slashOpen ? <SlashPalette onSelect={onSlashSelect} onClose={closeSlash} /> : null}
      <box
      
        paddingLeft={3}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        width="100%"
        flexShrink={0}
      >
          {target ? (
            <box flexDirection="row" flexShrink={0} paddingBottom={1}>
              <box
                flexDirection="row"
                gap={1}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={theme.backgroundPanel}
                onMouseDown={() => setTarget(null)}
              >
                <text fg={theme.accent} wrapMode="none">
                  ◇ {target.name}
                </text>
                <text fg={theme.textMuted} wrapMode="none">
                  ⌫
                </text>
              </box>
            </box>
          ) : null}
          <textarea
            ref={ref}
            focused={focused && !slashOpen}
            width="100%"
            minHeight={1}
            maxHeight={6}
            placeholder={placeholder}
            placeholderColor={theme.textMuted}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.text}
            backgroundColor={theme.backgroundElement}
            focusedBackgroundColor={theme.backgroundElement}
            onContentChange={onContent}
            onSubmit={submit}
            keyBindings={[
              { name: 'return', action: 'submit' },
              { name: 'return', shift: true, action: 'newline' },
            ]}
          />
          <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1}>
            {model ? <text fg={theme.primary}>{model}</text> : null}
          </box>
      </box>
      <box width="100%" flexDirection="row" justifyContent="space-between" gap={2} height={1} marginTop={1}>
        {busy ? (
          <>
            <box flexDirection="row" gap={1} marginLeft={1}>
              <Spinner color={theme.primary} />
              <text fg={theme.textMuted} wrapMode="none" flexShrink={1} truncate>
                {statusMsg || 'working'}
              </text>
            </box>
            <box flexDirection="row" gap={2} flexShrink={0}>
              <text fg={theme.textMuted} wrapMode="none">
                {fmtElapsed(elapsed)}
                {tokens ? ` · ↓ ${fmtTokens(tokens)} tokens` : ''}
              </text>
              <text fg={theme.text}>
                esc <span fg={theme.textMuted}>interrupt</span>
              </text>
            </box>
          </>
        ) : (
          <>
            <box marginLeft={1} flexShrink={1}>
              <text fg={theme.textMuted} wrapMode="none" truncate>
                {leftLabel}
              </text>
            </box>
            {/* One quiet pointer to the action menu — everything else is
                discoverable there or in F1, so the row stays free of shortcut spam. */}
            <box flexShrink={0}>
              <text fg={theme.textMuted} wrapMode="none">
                ctrl + p <span fg={theme.textMuted}>menu</span>
              </text>
            </box>
          </>
        )}
      </box>
    </box>
  );
}
