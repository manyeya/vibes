import { TextAttributes, extensionToFiletype, getTreeSitterClient } from '@opentui/core';
import type { UIMessage } from 'ai';
import { useState } from 'react';
import type { ClarificationData } from './question';
import { fmtElapsed, fmtTokens, syntaxStyle, theme } from '../theme';
import { Spinner } from './spinner';
import { Disclosure } from './ui';

type Part = UIMessage['parts'][number];

// Flat panel: the backgroundPanel block alone marks the user's message.
export function UserMessage({ message, first }: { message: UIMessage; first: boolean }) {
  const text = message.parts
    .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n');
  if (!text) return null;
  return (
    <box
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={3}
      backgroundColor={theme.backgroundPanel}
      marginTop={first ? 0 : 1}
      flexShrink={0}
    >
      <text fg={theme.text}>{text}</text>
    </box>
  );
}

// Tools whose activity is rendered from their richer data-* twin part
// (data-command, data-file_operation, data-task_graph, data-delegation,
// data-artifact, data-clarification) — the raw tool part would duplicate it.
const HIDDEN_TOOLS =
  /^(bash|readFile|writeFile|edit_file|list_files|ask_user|delegate|parallel_delegate|task|create_tasks|generate_tasks|generate_tasks_from_plan|create_subtask|update_task|clear_tasks|create_artifact|edit_artifact|request_plan_review|suggest_mode)$/;

function toolIcon(name: string): string {
  const n = name.toLowerCase();
  if (/(bash|shell|command|exec)/.test(n)) return '$';
  if (/read/.test(n)) return '→';
  if (/(write|edit)/.test(n)) return '←';
  if (/(glob|grep|list|search|find|recall)/.test(n)) return '✱';
  if (/web|fetch/.test(n)) return '◈';
  if (/(task|delegate|spawn|agent)/.test(n)) return '│';
  if (/artifact/.test(n)) return '▣';
  return '⚙';
}

const PRIMARY_ARGS = [
  'command',
  'path',
  'filePath',
  'file_path',
  'pattern',
  'query',
  'url',
  'title',
  'name',
  'task',
  'description',
];

function primaryArg(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  for (const key of PRIMARY_ARGS) {
    if (typeof obj[key] === 'string' && obj[key]) return obj[key] as string;
  }
  const firstString = Object.values(obj).find((v) => typeof v === 'string' && v);
  return (firstString as string) ?? '';
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

// One-line tool/data row, opencode InlineToolRow shape: 2-wide icon + label.
function Row({
  icon,
  label,
  color,
  spinner,
  children,
}: {
  icon: string;
  label: string;
  color?: string;
  spinner?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <box paddingLeft={3} flexShrink={0}>
      {spinner ? (
        <Spinner color={theme.text}>{label}</Spinner>
      ) : (
        <box flexDirection="row">
          <text width={2} fg={color ?? theme.textMuted}>
            {icon}
          </text>
          <text flexGrow={1} fg={color ?? theme.textMuted}>
            {label}
          </text>
        </box>
      )}
      {children}
    </box>
  );
}

function ToolRow({ part, busy }: { part: Part; busy: boolean }) {
  const p = part as {
    type: string;
    toolName?: string;
    state?: string;
    input?: unknown;
    errorText?: string;
  };
  const name = p.type === 'dynamic-tool' ? (p.toolName ?? 'tool') : p.type.slice('tool-'.length);
  if (HIDDEN_TOOLS.test(name)) return null;
  const icon = toolIcon(name);
  const arg = truncate(primaryArg(p.input), 64);
  const label = `${name}${arg ? ` ${arg}` : ''}`;

  if (p.state === 'input-streaming') {
    return busy ? <Row icon="~" label={`${name}…`} /> : null;
  }
  if (p.state === 'input-available') {
    return <Row icon={icon} label={label} spinner={busy} />;
  }
  const failed = p.state === 'output-error';
  return (
    <Row
      icon={icon}
      label={`${label}${failed && p.errorText ? ` · ${truncate(p.errorText, 60)}` : ''}`}
      color={failed ? theme.error : undefined}
    />
  );
}

// Shell panel block with `$ command` + output, collapsed to 10 lines.
const CMD_CAP = 10;
function CommandBlock({ data, busy }: { data: Record<string, unknown>; busy: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const running = data.status === 'running';
  const output = [data.stdout, data.stderr].filter(Boolean).join('\n').trim();
  const lines = output ? output.split('\n') : [];
  const shown = expanded ? lines : lines.slice(0, CMD_CAP);
  return (
    <box
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={3}
      gap={1}
      backgroundColor={theme.backgroundPanel}
      marginTop={1}
      flexShrink={0}
    >
      {running && busy ? (
        <Spinner color={theme.text}>{String(data.command ?? '')}</Spinner>
      ) : (
        <text fg={theme.primary}>$ {String(data.command ?? '')}</text>
      )}
      {shown.length ? <text fg={theme.text}>{shown.join('\n')}</text> : null}
      {lines.length > CMD_CAP ? (
        <Disclosure expanded={expanded} count={lines.length - CMD_CAP} noun="line" onToggle={() => setExpanded((v) => !v)} indent={0} />
      ) : null}
      {typeof data.exitCode === 'number' && data.exitCode !== 0 ? (
        <text fg={theme.error}>exit {String(data.exitCode)}</text>
      ) : null}
    </box>
  );
}

const DIFF_CAP = 8;
const LIST_CAP = 3;

// Claude Code-style diff: a subtle full-line background tint carries the +/-,
// not the whole line's text recolored green/red. Blend the accent toward the
// background so the code stays readable. Computed at render so it tracks theme.
const mixHex = (a: string, b: string, t: number): string => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 0xff) * (1 - t) + ((pb >> s) & 0xff) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
};
function FileOpRow({ data, busy }: { data: Record<string, unknown>; busy: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const op = String(data.operation ?? 'read');
  const icon = op === 'read' ? '→' : op === 'list' ? '✱' : '←';
  const verb = op === 'read' ? 'Read' : op === 'write' ? 'Wrote' : op === 'edit' ? 'Edited' : 'Listed';
  const detail =
    typeof data.fileCount === 'number'
      ? ` (${data.fileCount} files)`
      : typeof data.added === 'number' || typeof data.removed === 'number'
        ? ` (+${data.added ?? 0} -${data.removed ?? 0})`
        : typeof data.bytes === 'number'
          ? ` (${data.bytes}b)`
          : '';
  const label = `${verb} ${String(data.path ?? '')}${detail}`;
  const row = <Row icon={icon} label={label} spinner={data.status === 'running' && busy} />;

  // Preferred: a real unified diff → OpenTUI's native <diff>, which gives line
  // numbers, +/- gutters, per-line tint AND tree-sitter syntax highlighting.
  // Works for both edit and write ops (write emits a full-file / all-adds diff).
  const unified = typeof data.unifiedDiff === 'string' ? data.unifiedDiff : undefined;
  if ((op === 'edit' || op === 'write') && unified) {
    const bodyRows = unified.split('\n').length - 3; // minus ---, +++, @@ header
    const height = Math.min(Math.max(bodyRows + 1, 1), 30);
    // The renderer highlights via `filetype` (unresolved), so map the extension
    // to the tree-sitter filetype it expects (ts→typescript, tsx→typescriptreact).
    const ext = typeof data.filetype === 'string' ? data.filetype : undefined;
    const filetype = ext ? (extensionToFiletype.get(ext) ?? ext) : undefined;
    return (
      <box flexShrink={0}>
        {row}
        <box paddingLeft={5} flexShrink={0} height={height}>
          <diff
            diff={unified}
            filetype={filetype}
            syntaxStyle={syntaxStyle}
            treeSitterClient={getTreeSitterClient()}
            view="unified"
            wrapMode="none"
            showLineNumbers
            lineNumberFg={theme.textMuted}
            addedSignColor={theme.success}
            removedSignColor={theme.error}
            // Subtle Claude-style tint — faint enough that syntax colors read through.
            contextBg={theme.background}
            addedContentBg={mixHex(theme.success, theme.background, 0.9)}
            removedContentBg={mixHex(theme.error, theme.background, 0.9)}
          />
        </box>
      </box>
    );
  }

  // Fallback (restored history has no unified diff): compact tinted ±block.
  const diff = data.diff as { removed?: string[]; added?: string[] } | undefined;
  if (op === 'edit' && diff && (diff.removed?.length || diff.added?.length)) {
    const lines = [
      ...(diff.removed ?? []).map((l) => ['-', l] as const),
      ...(diff.added ?? []).map((l) => ['+', l] as const),
    ];
    const shown = expanded ? lines : lines.slice(0, DIFF_CAP);
    const addBg = mixHex(theme.success, theme.background, 0.78);
    const delBg = mixHex(theme.error, theme.background, 0.78);
    return (
      <box flexShrink={0}>
        {row}
        <box paddingLeft={5} flexShrink={0}>
          {shown.map(([sign, line], i) => {
            const bg = sign === '-' ? delBg : addBg;
            return (
              <box key={i} width="100%" backgroundColor={bg} flexShrink={0}>
                <text fg={theme.text} bg={bg} wrapMode="none" truncate>
                  {sign} {line}
                </text>
              </box>
            );
          })}
        </box>
        {lines.length > DIFF_CAP ? (
          <Disclosure expanded={expanded} count={lines.length - DIFF_CAP} noun="line" onToggle={() => setExpanded((v) => !v)} />
        ) : null}
      </box>
    );
  }
  const files = Array.isArray(data.files) ? (data.files as string[]) : undefined;
  if (op === 'list' && files?.length) {
    const shown = expanded ? files : files.slice(0, LIST_CAP);
    return (
      <box flexShrink={0}>
        {row}
        <box paddingLeft={5} flexShrink={0}>
          {shown.map((f, i) => (
            <text key={i} fg={theme.textMuted} wrapMode="none" truncate>
              {f}
            </text>
          ))}
        </box>
        {files.length > LIST_CAP ? (
          <Disclosure expanded={expanded} count={files.length - LIST_CAP} noun="file" onToggle={() => setExpanded((v) => !v)} />
        ) : null}
      </box>
    );
  }
  return row;
}

function DelegationRow({ data, busy }: { data: Record<string, unknown>; busy: boolean }) {
  const status = String(data.status ?? '');
  const running = status === 'starting' || status === 'in_progress';
  const failed = status === 'failed';
  const label = `${String(data.agentName ?? 'agent')} Task — ${truncate(String(data.task ?? ''), 60)}${
    data.cached ? ' · cached' : data.inferred ? ' · inferred' : ''
  }`;
  const detail = failed
    ? truncate(String(data.error ?? 'failed'), 70)
    : typeof data.summary === 'string' && data.summary
      ? truncate(data.summary, 70)
      : '';
  return (
    <box marginTop={1} flexShrink={0}>
      <Row
        icon={failed ? '✗' : running ? '│' : '✓'}
        label={label}
        color={failed ? theme.error : running ? theme.text : undefined}
        spinner={running && busy}
      />
      {detail ? (
        <box paddingLeft={5} flexShrink={0}>
          <text fg={failed ? theme.error : theme.textMuted}>↳ {detail}</text>
        </box>
      ) : null}
    </box>
  );
}

export function DataPart({ part, busy }: { part: Part; busy: boolean }) {
  const { type } = part;
  const data = (part as { data: Record<string, unknown> }).data ?? {};
  switch (type) {
    case 'data-command':
      return <CommandBlock data={data} busy={busy} />;
    case 'data-file_operation':
      return <FileOpRow data={data} busy={busy} />;
    case 'data-delegation':
      return <DelegationRow data={data} busy={busy} />;
    case 'data-task_graph':
      // Rendered by the sticky TaskPanel above the composer, not inline.
      return null;
    case 'data-search': {
      const n = typeof data.count === 'number' ? ` (${data.count} results)` : '';
      const results = Array.isArray(data.results)
        ? (data.results as Array<{ title?: string; url?: string }>)
        : [];
      return (
        <box flexShrink={0}>
          <Row
            icon="◈"
            label={`Web Search "${truncate(String(data.query ?? ''), 50)}"${n}`}
            spinner={data.status === 'running' && busy}
          />
          {results.slice(0, 3).map((r, i) => (
            <box key={i} paddingLeft={5} flexShrink={0}>
              <text fg={theme.textMuted} wrapMode="none" truncate>
                ↳{' '}
                {r.url ? (
                  // Real terminal hyperlink (OSC 8) — clickable / ⌘-clickable in
                  // modern terminals, instead of an inert truncated string.
                  <a href={r.url} fg={theme.info} attributes={TextAttributes.UNDERLINE}>
                    {truncate(String(r.title ?? r.url), 70)}
                  </a>
                ) : (
                  truncate(String(r.title ?? ''), 70)
                )}
              </text>
            </box>
          ))}
        </box>
      );
    }
    case 'data-skill':
      return data.action === 'activate' ? <Row icon="✱" label={`Skill ${String(data.name ?? '')}`} /> : null;
    case 'data-memory_update':
      return <Row icon="⚙" label={`Memory ${String(data.action ?? '')}${data.title ? ` — ${data.title}` : ''}`} />;
    case 'data-artifact':
      return (
        <Row
          icon="▣"
          label={`Artifact ${String(data.title ?? '')} (${String(data.kind ?? '')})`}
          spinner={data.status === 'streaming' && busy}
        />
      );
    case 'data-mode':
      return (
        <Row
          icon="◆"
          label={
            data.suggested
              ? `Suggests ${String(data.mode ?? '')} mode${data.reason ? ` — ${truncate(String(data.reason), 60)}` : ''} · shift+tab to switch`
              : `Mode → ${String(data.mode ?? '')}${data.reason ? ` · ${truncate(String(data.reason), 70)}` : ''}`
          }
          color={data.suggested ? theme.warning : theme.accent}
        />
      );
    case 'data-error':
      return <Row icon="⚠" label={truncate(String(data.error ?? 'error'), 80)} color={theme.error} />;
    case 'data-guardrail':
      return (
        <Row
          icon="△"
          label={`${String(data.guardrail ?? 'guardrail')} ${String(data.action ?? '')} — ${truncate(String(data.message ?? ''), 60)}`}
          color={theme.warning}
        />
      );
    case 'data-summarization':
      // opencode renders compaction as a titled horizontal rule.
      if (data.stage === 'failed') {
        return <Row icon="⚠" label={`compaction failed: ${truncate(String(data.error ?? ''), 60)}`} color={theme.error} />;
      }
      if (data.stage !== 'complete') return null;
      return (
        <box
          marginTop={1}
          border={['top']}
          title=" Compacted "
          titleAlignment="center"
          borderColor={theme.borderActive}
          flexShrink={0}
        />
      );
    case 'data-clarification': {
      // Interactive form is pinned above the composer (see QuestionPrompt);
      // inline this is just the historical record.
      const c = data as unknown as ClarificationData;
      return <Row icon="?" label={c.title ?? c.questions?.[0]?.question ?? 'Question'} color={theme.accent} />;
    }
    case 'data-task_update':
      // Rendered by the sticky TaskPanel above the composer, not inline (each
      // status change used to stream its own row — that was the duplication).
      return null;
    case 'data-status': {
      // Transient progress: parts persist to history, so the busy gate is
      // what keeps them out of the finished transcript.
      if (!busy) return null;
      const steps =
        typeof data.step === 'number' && typeof data.totalSteps === 'number' ? ` (${data.step}/${data.totalSteps})` : '';
      return <Row icon="›" label={`${truncate(String(data.message ?? ''), 70)}${steps}`} />;
    }
    case 'data-tool_progress': {
      if (!busy || data.stage === 'complete' || data.stage === 'failed') return null;
      const label = truncate(String(data.message ?? `${data.toolName ?? 'tool'} ${data.stage ?? ''}`), 70);
      return <Row icon="⚙" label={label} spinner />;
    }
    case 'data-notification': {
      // Currently dead: the only writer marks these transient (never persisted);
      // live ones surface via statusMsg in session.tsx. Kept for parity.
      const level = String(data.level ?? 'info');
      return (
        <Row
          icon={level === 'error' ? '⚠' : level === 'warning' ? '△' : 'ℹ'}
          label={truncate(String(data.message ?? ''), 80)}
          color={level === 'error' ? theme.error : level === 'warning' ? theme.warning : undefined}
        />
      );
    }
    case 'data-agent_message':
    case 'data-agent_thought': {
      const text = truncate(String(data.text ?? ''), 70);
      if (!text) return null;
      const thought = type === 'data-agent_thought';
      return (
        <Row
          icon={thought ? '+' : '│'}
          label={`${String(data.agentName ?? 'agent')}${thought ? ' thought' : ''} — ${text}`}
          color={thought ? theme.warning : undefined}
        />
      );
    }
    case 'data-plan_review': {
      const tasks = Array.isArray(data.tasks) ? data.tasks.length : 0;
      return (
        <box
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={3}
          backgroundColor={theme.backgroundPanel}
          marginTop={1}
          flexShrink={0}
        >
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            Plan review — {String(data.title ?? '')}
          </text>
          {typeof data.solution === 'string' && data.solution ? (
            <text fg={theme.text}>{truncate(data.solution, 200)}</text>
          ) : null}
          <text fg={theme.textMuted}>
            {tasks} tasks · reply to approve or request changes
          </text>
        </box>
      );
    }
    default:
      return null;
  }
}

function Reasoning({ part, streaming }: { part: Extract<Part, { type: 'reasoning' }>; streaming: boolean }) {
  if (!part.text.trim()) return null;
  return (
    <box paddingLeft={3} marginTop={1} flexShrink={0}>
      {streaming ? (
        <Spinner color={theme.warning}>Thinking</Spinner>
      ) : (
        <text fg={theme.warning} attributes={TextAttributes.DIM}>
          + Thought
        </text>
      )}
    </box>
  );
}

export function AssistantMessage({
  message,
  streaming,
  busy,
  model,
  seconds,
  hideDelegated,
}: {
  message: UIMessage;
  streaming: boolean;
  busy: boolean;
  model?: string;
  /** Turn duration, recorded by the session screen when the turn finished. */
  seconds?: number;
  /** On the main view, hide sub-agent data parts — they belong to their tab. */
  hideDelegated?: boolean;
}) {
  const parts = message.parts;
  // Same chars/4 estimate as the live tracker, so the stamped count matches.
  const tokens = Math.round(
    parts.reduce((n, p) => {
      const text = (p as { text?: unknown }).text;
      return n + (typeof text === 'string' ? text.length : 0);
    }, 0) / 4,
  );
  return (
    <box flexShrink={0}>
      {parts.map((part, i) => {
        const last = i === parts.length - 1;
        if (part.type === 'text' && part.text.trim()) {
          return (
            <box key={i} paddingLeft={3} marginTop={1} flexShrink={0}>
              <markdown
                syntaxStyle={syntaxStyle}
                streaming={streaming && last}
                // Coalesced mode rewrites the whole folded blob on every chunk,
                // repainting emoji graphemes (visible flicker on headers);
                // top-level mode reuses blocks whose raw text didn't change.
                internalBlockMode={streaming && last ? 'top-level' : 'coalesced'}
                tableOptions={{ style: 'grid' }}
                content={part.text.trim()}
                fg={theme.text}
                bg={theme.background}
              />
            </box>
          );
        }
        if (part.type === 'reasoning') {
          return <Reasoning key={i} part={part} streaming={streaming && last} />;
        }
        if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
          return <ToolRow key={i} part={part} busy={busy} />;
        }
        if (part.type.startsWith('data-')) {
          // Sub-agent activity (any data part carrying a delegationId, except
          // the delegation handoff itself) is routed to that agent's tab.
          if (hideDelegated && part.type !== 'data-delegation') {
            const delegationId = (part as { data?: { delegationId?: string } }).data?.delegationId;
            if (delegationId) return null;
          }
          return <DataPart key={i} part={part} busy={busy} />;
        }
        return null;
      })}
      {!streaming ? (
        <box paddingLeft={3} marginTop={1} flexShrink={0}>
          <text>
            <span fg={theme.primary}>▣ </span>
            {model ? <span fg={theme.text}>{model}</span> : null}
            {seconds != null ? <span fg={theme.textMuted}> · {fmtElapsed(seconds)}</span> : null}
            {tokens > 0 ? <span fg={theme.textMuted}> · ↓ {fmtTokens(tokens)} tokens</span> : null}
          </text>
        </box>
      ) : null}
    </box>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <box
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={3}
      backgroundColor={theme.backgroundPanel}
      marginTop={1}
      flexShrink={0}
    >
      <text fg={theme.error}>{message}</text>
    </box>
  );
}
