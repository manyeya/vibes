import React, { useEffect, useRef, useState } from 'react';

/**
 * Renders a mermaid diagram. Mermaid is heavy, so it is dynamically imported
 * only when a diagram artifact is actually viewed. Each render gets a unique
 * id; parse errors fall back to showing the raw source.
 */

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'strict',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        themeVariables: {
          background: 'transparent',
          primaryColor: '#2a2620',
          primaryBorderColor: '#e0a458',
          primaryTextColor: '#f4eee4',
          lineColor: '#7f7466',
          fontSize: '14px',
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export const MermaidView: React.FC<{ content: string; version: number }> = ({ content, version }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mmd-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadMermaid()
      .then((mermaid) => mermaid.render(`${idRef.current}-${version}`, content.trim()))
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [content, version]);

  if (error) {
    return (
      <div className="m-6 space-y-3">
        <div className="rounded-lg border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] p-3 font-mono text-[12px] text-[color:var(--color-ember)]">
          Mermaid error: {error}
        </div>
        <pre className="overflow-auto rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-ground)] p-3 font-mono text-[12px] text-[color:var(--color-ink-soft)]">
          {content}
        </pre>
      </div>
    );
  }

  return (
    <div
      className="flex h-full items-center justify-center overflow-auto p-6 [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
