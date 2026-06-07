import React, { useEffect, useRef, useState } from 'react';
import { codeToHtml } from 'shiki';
import { Markdown } from '../Markdown';
import { MermaidView } from './MermaidView';
import { ChartView } from './ChartView';
import type { ArtifactData } from '../data-parts/types';

/** Shiki grammar to use for each artifact kind's raw source. */
const KIND_LANGUAGE: Record<ArtifactData['kind'], string> = {
  html: 'html',
  markdown: 'markdown',
  mermaid: 'mermaid',
  chart: 'json',
};

/** Renders the *preview* of an artifact according to its kind. */
const Preview: React.FC<{ artifact: ArtifactData }> = ({ artifact }) => {
  switch (artifact.kind) {
    case 'html':
      return (
        <iframe
          // Re-mount on each completed version so the document fully reloads.
          key={artifact.version}
          title={artifact.title}
          srcDoc={artifact.content}
          className="h-full w-full border-0 bg-white"
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
        />
      );
    case 'markdown':
      return (
        <div className="mx-auto max-w-3xl px-8 py-8">
          <div className="streamdown text-[15px] leading-relaxed text-[color:var(--color-ink)]">
            <Markdown>{artifact.content}</Markdown>
          </div>
        </div>
      );
    case 'mermaid':
      return <MermaidView content={artifact.content} version={artifact.version} />;
    case 'chart':
      return <ChartView content={artifact.content} />;
    default:
      return null;
  }
};

/** Raw source view. While the artifact is streaming, it sticks to the bottom
 *  and shows a caret so you can watch the model write it; once finished, the
 *  source is syntax-highlighted with Shiki (single dark theme — the app is
 *  always dark). Highlighting is skipped while streaming because re-tokenising
 *  a fast-growing buffer on every delta is wasteful and the live caret matters
 *  more there. */
const CodeView: React.FC<{ artifact: ArtifactData }> = ({ artifact }) => {
  const ref = useRef<HTMLPreElement>(null);
  const streaming = artifact.status === 'streaming';
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // Stick to the bottom as the source streams in.
  useEffect(() => {
    if (streaming && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [artifact.content, streaming]);

  // Highlight the finished source. An unknown grammar (e.g. mermaid on an older
  // Shiki) just falls back to the plain view.
  useEffect(() => {
    if (streaming || !artifact.content) {
      setHighlighted(null);
      return;
    }
    let cancelled = false;
    codeToHtml(artifact.content, {
      lang: KIND_LANGUAGE[artifact.kind] ?? 'text',
      theme: 'github-dark',
    })
      .then((html) => { if (!cancelled) setHighlighted(html); })
      .catch(() => { if (!cancelled) setHighlighted(null); });
    return () => { cancelled = true; };
  }, [artifact.content, artifact.kind, streaming]);

  if (!streaming && highlighted) {
    return (
      <div
        className="artifact-code h-full overflow-auto bg-[color:var(--color-ground)] p-5 text-[12.5px] leading-relaxed"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    );
  }

  return (
    <pre
      ref={ref}
      className="h-full overflow-auto bg-[color:var(--color-ground)] p-5 font-mono text-[12.5px] leading-relaxed text-[color:var(--color-ink-soft)]"
    >
      <code>{artifact.content}</code>
      {streaming &&
        (artifact.content ? (
          <span className="ml-0.5 inline-block h-[1.05em] w-[7px] translate-y-[2px] animate-pulse bg-[color:var(--color-amber)] align-middle" />
        ) : (
          <span className="text-[color:var(--color-ink-faint)]">Writing…</span>
        ))}
    </pre>
  );
};

export const ArtifactView: React.FC<{ artifact: ArtifactData; mode: 'preview' | 'code' }> = ({ artifact, mode }) => {
  if (mode === 'code') return <CodeView artifact={artifact} />;
  return (
    <div className="h-full w-full overflow-auto bg-[color:var(--color-ground)]">
      <Preview artifact={artifact} />
    </div>
  );
};
