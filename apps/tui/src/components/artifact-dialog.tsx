import { RGBA, TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useState } from 'react';
import { syntaxStyle, theme } from '../theme';

export interface ArtifactData {
  id: string;
  title?: string;
  kind?: string;
  content?: string;
  version?: number;
  status?: string;
  path?: string;
}

const EXT: Record<string, string> = { html: 'html', markdown: 'md', mermaid: 'html', chart: 'json' };
const CODE_LANG: Record<string, string> = { html: 'html', chart: 'json', mermaid: 'mermaid' };

// The terminal can't render html/mermaid/chart — hand those to the browser.
// Content is written to a temp file (the artifact path lives in the server's
// workspace, which the TUI can't resolve); mermaid gets a CDN wrapper page.
function openInBrowser(a: ArtifactData) {
  const kind = a.kind ?? 'markdown';
  let body = a.content ?? '';
  if (kind === 'mermaid') {
    body = `<!doctype html><html><body style="background:#111"><pre class="mermaid">\n${body}\n</pre><script type="module">import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";mermaid.initialize({startOnLoad:true,theme:"dark"});</script></body></html>`;
  }
  const file = `${process.env.TMPDIR ?? '/tmp/'}vibes-artifact-${a.id}.${EXT[kind] ?? 'txt'}`;
  Bun.write(file, body)
    .then(() => Bun.spawn([process.platform === 'darwin' ? 'open' : 'xdg-open', file]))
    .catch(() => {});
}

export function ArtifactDialog({ artifacts, onClose }: { artifacts: ArtifactData[]; onClose: () => void }) {
  const { width, height } = useTerminalDimensions();
  const [selected, setSelected] = useState(0);
  const [viewing, setViewing] = useState<ArtifactData | null>(null);

  const sel = Math.min(selected, Math.max(0, artifacts.length - 1));

  useKeyboard((key) => {
    if (key.name === 'escape') {
      if (viewing) return setViewing(null);
      return onClose();
    }
    if (key.name === 'o') {
      const target = viewing ?? artifacts[sel];
      if (target) openInBrowser(target);
      return;
    }
    if (viewing) return; // arrows scroll the focused scrollbox
    if (key.name === 'up') setSelected((i) => (i <= 0 ? artifacts.length - 1 : i - 1));
    if (key.name === 'down') setSelected((i) => (i >= artifacts.length - 1 ? 0 : i + 1));
    if (key.name === 'return' && artifacts[sel]) setViewing(artifacts[sel]!);
  });

  const kind = viewing?.kind ?? 'markdown';
  const source =
    kind === 'markdown'
      ? (viewing?.content ?? '')
      : `\`\`\`${CODE_LANG[kind] ?? ''}\n${viewing?.content ?? ''}\n\`\`\``;

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={2}
      zIndex={3000}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        width={Math.min(100, width - 4)}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
      >
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {viewing ? `${viewing.title ?? viewing.id} (${kind})` : 'Artifacts'}
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        <box paddingTop={1}>
          {viewing ? (
            <scrollbox focused width="100%" maxHeight={height - 10}>
              <markdown
                width="100%"
                syntaxStyle={syntaxStyle}
                content={source}
                fg={theme.text}
                bg={theme.backgroundPanel}
              />
            </scrollbox>
          ) : artifacts.length === 0 ? (
            <text fg={theme.textMuted}>No artifacts in this session yet</text>
          ) : (
            artifacts.map((a, i) => {
              const active = i === sel;
              return (
                <box key={a.id} flexDirection="row" gap={1} paddingLeft={1} backgroundColor={active ? theme.primary : undefined}>
                  <text fg={active ? theme.background : theme.textMuted}>▣</text>
                  <text flexGrow={1} fg={active ? theme.background : theme.text} wrapMode="none" truncate>
                    {a.title ?? a.id}
                  </text>
                  <text fg={active ? theme.background : theme.textMuted}>
                    {a.kind ?? '?'}
                    {a.version != null ? ` v${a.version}` : ''}
                    {a.status === 'streaming' ? ' …' : ''}
                  </text>
                </box>
              );
            })
          )}
        </box>
        <box paddingTop={1} flexDirection="row" gap={2}>
          {viewing ? (
            <text fg={theme.text}>
              ↑↓ <span fg={theme.textMuted}>scroll</span>
            </text>
          ) : (
            <text fg={theme.text}>
              enter <span fg={theme.textMuted}>view</span>
            </text>
          )}
          <text fg={theme.text}>
            o <span fg={theme.textMuted}>open in browser</span>
          </text>
        </box>
      </box>
    </box>
  );
}
