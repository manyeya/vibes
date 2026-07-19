import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useState } from 'react';
import { theme } from '../theme';

export interface ApprovalRequest {
  id: string;
  toolName: string;
  input?: unknown;
}

// Best-effort one-line summary of what the tool will do (the command / path /
// first string arg), so the user can decide without reading raw JSON.
function summarize(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  for (const k of ['command', 'path', 'filePath', 'file_path', 'pattern', 'url', 'task', 'description']) {
    if (typeof o[k] === 'string' && o[k]) return o[k] as string;
  }
  const first = Object.values(o).find((v) => typeof v === 'string' && v);
  return (first as string) ?? '';
}

/**
 * Tool-approval gate for manual / auto-edit modes. When a tool needs sign-off
 * the run halts (approval-required); this pins the request above the composer
 * with Approve (y) / Deny (n) and hands the decision back via
 * `addToolApprovalResponse`, which resumes the run. Without this the turn just
 * froze — nothing consumed the request.
 */
export function ApprovalPrompt({
  request,
  active,
  onApprove,
  onDeny,
}: {
  request: ApprovalRequest;
  active: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const [selected, setSelected] = useState(0); // 0 = approve, 1 = deny
  const detail = summarize(request.input);

  useKeyboard((key) => {
    if (!active) return;
    if (key.name === 'y') return onApprove();
    if (key.name === 'n' || key.name === 'escape') return onDeny();
    if (key.name === 'left') return setSelected(0);
    if (key.name === 'right') return setSelected(1);
    if (key.name === 'tab') return setSelected((s) => (s === 0 ? 1 : 0));
    if (key.name === 'return') return selected === 0 ? onApprove() : onDeny();
  });

  return (
    <box backgroundColor={theme.backgroundPanel} flexShrink={0} paddingLeft={2} paddingRight={3} paddingTop={1} paddingBottom={1}>
      <box flexDirection="row" gap={1}>
        <text fg={theme.warning} attributes={TextAttributes.BOLD} wrapMode="none">
          ⚿ Permission
        </text>
        <text fg={theme.text} wrapMode="none">
          {request.toolName}
        </text>
      </box>
      {detail ? (
        <box paddingTop={1}>
          <text fg={theme.textMuted} wrapMode="none" truncate>
            {detail}
          </text>
        </box>
      ) : null}
      <box flexDirection="row" gap={2} paddingTop={1}>
        <box paddingLeft={1} paddingRight={1} backgroundColor={selected === 0 ? theme.success : undefined}>
          <text fg={selected === 0 ? theme.background : theme.text}>✓ Approve</text>
        </box>
        <box paddingLeft={1} paddingRight={1} backgroundColor={selected === 1 ? theme.error : undefined}>
          <text fg={selected === 1 ? theme.background : theme.text}>✗ Deny</text>
        </box>
        <box flexGrow={1} />
        <text fg={theme.text}>
          y <span fg={theme.textMuted}>approve</span>
        </text>
        <text fg={theme.text}>
          n <span fg={theme.textMuted}>deny</span>
        </text>
      </box>
    </box>
  );
}
