import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Globe,
  FileText,
  Workflow,
  BarChart3,
  Code2,
  Eye,
  Copy,
  Check,
  Download,
  Maximize2,
  Minimize2,
  X,
  Loader2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { ArtifactView } from './ArtifactView';
import type { ArtifactData, ArtifactKind } from '../data-parts/types';

const KIND_ICON: Record<ArtifactKind, React.ElementType> = {
  html: Globe,
  markdown: FileText,
  mermaid: Workflow,
  chart: BarChart3,
};
const KIND_LABEL: Record<ArtifactKind, string> = {
  html: 'Website',
  markdown: 'Document',
  mermaid: 'Diagram',
  chart: 'Chart',
};
const EXT: Record<ArtifactKind, string> = { html: 'html', markdown: 'md', mermaid: 'mmd', chart: 'json' };

/** Min docked width for the canvas; drag can grow it up to ~85vw. */
const MIN_W = 420;

interface ArtifactPanelProps {
  artifacts: ArtifactData[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export const ArtifactPanel: React.FC<ArtifactPanelProps> = ({ artifacts, activeId, onSelect, onClose }) => {
  const [mode, setMode] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const userPickedMode = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('vibes_canvas_width'));
    return saved >= MIN_W ? saved : Math.round(Math.min(960, Math.max(MIN_W, window.innerWidth * 0.46)));
  });

  const active = artifacts.find((a) => a.id === activeId) ?? artifacts[artifacts.length - 1];
  const streaming = active?.status === 'streaming';

  // Reset the manual view override whenever we switch artifacts.
  useEffect(() => {
    userPickedMode.current = false;
  }, [active?.id]);

  // Follow the lifecycle: show the source as it streams in, then flip to the
  // rendered preview once it's finished — unless the user picked a view.
  useEffect(() => {
    if (!userPickedMode.current) setMode(streaming ? 'code' : 'preview');
  }, [streaming, active?.id]);

  const pickMode = (m: 'preview' | 'code') => {
    userPickedMode.current = true;
    setMode(m);
  };

  // Drag the left edge to resize. The panel hugs the viewport's right edge, so
  // its width is (viewport right − cursor x), clamped to leave room for chat.
  // `body.canvas-resizing` kills iframe pointer-events during the drag — an HTML
  // preview iframe otherwise captures the mouse and the parent window stops
  // getting mousemove, which was the jank — and updates are coalesced to one
  // per animation frame.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const clamp = (w: number) => Math.min(window.innerWidth - 360, Math.max(MIN_W, w));
    let last = width;
    let raf = 0;
    const flush = () => { raf = 0; setWidth(last); };
    const onMove = (ev: MouseEvent) => {
      last = clamp(window.innerWidth - ev.clientX);
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onUp = () => {
      if (raf) cancelAnimationFrame(raf);
      setWidth(last);
      document.body.classList.remove('canvas-resizing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      localStorage.setItem('vibes_canvas_width', String(Math.round(last)));
    };
    document.body.classList.add('canvas-resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Esc exits full view.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (!active) return null;
  const Icon = KIND_ICON[active.kind];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(active.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const download = () => {
    const blob = new Blob([active.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active.id}.${EXT[active.kind]}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.aside
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 28 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      style={expanded ? undefined : { width, maxWidth: '85vw' }}
      className={cn(
        'flex h-full shrink-0 flex-col bg-[color:var(--color-ground)]',
        expanded
          ? 'fixed inset-0 z-50 w-full'
          : 'relative border-l border-[color:var(--color-line-strong)]',
      )}
    >
      {/* Drag-to-resize handle (docked mode only) */}
      {!expanded && (
        <div
          onMouseDown={startResize}
          title="Drag to resize"
          className="group absolute left-0 top-0 z-20 h-full w-1.5 -translate-x-1/2 cursor-col-resize"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-[color:var(--color-amber)]" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[color:var(--color-line)] px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[rgba(224,164,88,0.12)] text-[color:var(--color-amber)]">
          {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-[color:var(--color-ink)]">{active.title}</div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-faint)]">
            <span>{KIND_LABEL[active.kind]}</span>
            <span className="opacity-40">·</span>
            <span>v{active.version}</span>
            {active.path && (
              <>
                <span className="opacity-40">·</span>
                <span className="truncate normal-case tracking-normal">{active.path}</span>
              </>
            )}
          </div>
        </div>

        {/* Preview / Code toggle */}
        <div className="flex items-center rounded-lg border border-[color:var(--color-line)] p-0.5">
          {(['preview', 'code'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => pickMode(m)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors',
                mode === m
                  ? 'bg-[color:var(--color-surface)] text-[color:var(--color-ink)]'
                  : 'text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink-soft)]',
              )}
            >
              {m === 'preview' ? <Eye className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
              {m === 'preview' ? 'Preview' : 'Code'}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Exit full view (Esc)' : 'Full view'}
          className="icon-btn"
        >
          {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button type="button" onClick={copy} title="Copy source" className="icon-btn">
          {copied ? <Check className="h-4 w-4 text-[color:var(--color-moss)]" /> : <Copy className="h-4 w-4" />}
        </button>
        <button type="button" onClick={download} title="Download" className="icon-btn">
          <Download className="h-4 w-4" />
        </button>
        <button type="button" onClick={onClose} title="Close canvas" className="icon-btn">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="relative min-h-0 flex-1">
        <ArtifactView artifact={active} mode={mode} />
      </div>

      {/* Switcher — only when there's more than one artifact */}
      {artifacts.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-t border-[color:var(--color-line)] px-3 py-2">
          <span className="shrink-0 pr-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-faint)]">
            {artifacts.length} artifacts
          </span>
          {artifacts.map((a) => {
            const AIcon = KIND_ICON[a.kind];
            const on = a.id === active.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelect(a.id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                  on
                    ? 'border-[color:var(--color-amber)]/60 bg-[rgba(224,164,88,0.1)] text-[color:var(--color-ink)]'
                    : 'border-[color:var(--color-line)] text-[color:var(--color-ink-soft)] hover:border-[color:var(--color-line-strong)]',
                )}
              >
                <AIcon className="h-3 w-3 shrink-0 opacity-70" />
                <span className="max-w-[120px] truncate">{a.title}</span>
              </button>
            );
          })}
        </div>
      )}

      <style>{`
        .icon-btn {
          display: flex; height: 28px; width: 28px; align-items: center; justify-content: center;
          border-radius: 8px; color: var(--color-ink-faint); transition: color .15s, background-color .15s;
        }
        .icon-btn:hover { color: var(--color-ink); background-color: var(--color-surface); }
        body.canvas-resizing { cursor: col-resize; user-select: none; }
        body.canvas-resizing iframe { pointer-events: none; }
      `}</style>
    </motion.aside>
  );
};
