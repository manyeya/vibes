import React from 'react';
import { motion } from 'framer-motion';
import { Globe, FileText, Workflow, BarChart3, Loader2, ArrowUpRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useArtifacts } from '../artifacts/ArtifactsContext';
import { animationProps, type ArtifactData, type ArtifactKind } from './types';

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

/**
 * Compact, clickable representation of an artifact in the chat stream. Clicking
 * opens (and focuses) the canvas side-panel. The full content lives in the
 * panel — this is just the handle.
 */
export const ArtifactPart: React.FC<{ data: ArtifactData }> = ({ data }) => {
  const { open, activeId } = useArtifacts();
  if (!data?.id) return null;
  const Icon = KIND_ICON[data.kind] ?? FileText;
  const streaming = data.status === 'streaming';
  const isActive = activeId === data.id;

  return (
    <motion.button
      {...animationProps}
      type="button"
      onClick={() => open(data.id)}
      className={cn(
        'group flex w-full max-w-md items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
        isActive
          ? 'border-[color:var(--color-amber)]/60 bg-[rgba(224,164,88,0.08)]'
          : 'border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] hover:border-[color:var(--color-amber)]/50',
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(224,164,88,0.12)] text-[color:var(--color-amber)]">
        {streaming ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Icon className="h-[18px] w-[18px]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-[color:var(--color-ink)]">{data.title}</span>
        <span className="block truncate font-mono text-[10.5px] uppercase tracking-[0.12em] text-[color:var(--color-ink-faint)]">
          {KIND_LABEL[data.kind] ?? data.kind}
          {data.version > 1 ? ` · v${data.version}` : ''}
          {streaming ? ' · writing…' : ''}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-faint)] group-hover:text-[color:var(--color-amber)]">
        Open
        <ArrowUpRight className="h-3.5 w-3.5" />
      </span>
    </motion.button>
  );
};
