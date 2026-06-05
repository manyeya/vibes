import React from 'react';
import { motion } from 'framer-motion';
import { FileText, FilePlus, FolderOpen, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, type FileOperationData } from './types';

const opMeta: Record<FileOperationData['operation'], { icon: React.ElementType; label: string; color: string }> = {
  read: { icon: FileText, label: 'Read', color: 'text-[color:var(--color-ink-soft)]' },
  write: { icon: FilePlus, label: 'Wrote', color: 'text-[color:var(--color-moss)]' },
  list: { icon: FolderOpen, label: 'Listed', color: 'text-[color:var(--color-amber)]' },
};

export const FileOperationPart: React.FC<{ data: FileOperationData }> = ({ data }) => {
  const meta = opMeta[data.operation];
  const Icon = meta.icon;
  const running = data.status === 'running';

  return (
    <motion.div
      {...animationProps}
      className="w-full rounded-lg border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] px-3 py-2"
    >
      <div className="flex items-center gap-2.5">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.color)} />
        <span className="font-mono text-[10px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">{meta.label}</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-[color:var(--color-ink)]">{data.path}</code>
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[color:var(--color-amber)]" />
        ) : (
          <span className="shrink-0 font-mono text-[10px] text-[color:var(--color-ink-faint)]">
            {data.operation === 'write' && data.bytes != null && `${data.bytes} B`}
            {data.operation === 'list' && data.fileCount != null && `${data.fileCount} file${data.fileCount === 1 ? '' : 's'}`}
          </span>
        )}
      </div>
      {data.operation === 'list' && data.files && data.files.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
          {data.files.slice(0, 12).map((f) => (
            <span key={f} className="rounded bg-[rgba(244,238,228,0.05)] px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--color-ink-soft)]">
              {f}
            </span>
          ))}
          {data.fileCount != null && data.fileCount > 12 && (
            <span className="px-1 py-0.5 font-mono text-[10px] text-[color:var(--color-ink-faint)]">+{data.fileCount - 12} more</span>
          )}
        </div>
      )}
    </motion.div>
  );
};
