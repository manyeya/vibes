import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { X } from 'lucide-react';

interface SessionCardProps {
  id: string;
  title?: string;
  isActive: boolean;
  messageCount: number;
  timeLabel?: string;
  onSelect: () => void;
  onDelete: () => void;
}

export const SessionCard: React.FC<SessionCardProps> = ({
  id,
  title,
  isActive,
  messageCount,
  timeLabel,
  onSelect,
  onDelete,
}) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      onClick={onSelect}
      className={cn(
        'group relative flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
        isActive
          ? 'border-[color:var(--color-line-strong)] bg-[rgba(244,238,228,0.06)]'
          : 'border-transparent hover:bg-[rgba(244,238,228,0.035)]'
      )}
    >
      {/* status dot — amber when active, faint otherwise (no side-stripe) */}
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full transition-colors',
          isActive
            ? 'bg-[color:var(--color-amber)]'
            : 'bg-[color:var(--color-ink-faint)] group-hover:bg-[color:var(--color-ink-soft)]'
        )}
      />

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate text-[13px] leading-tight',
            isActive ? 'text-[color:var(--color-ink)]' : 'text-[color:var(--color-ink-soft)]'
          )}
        >
          {title || 'Untitled session'}
        </div>
        <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-faint)]">
          {timeLabel && <span>{timeLabel}</span>}
          {timeLabel && messageCount > 0 && <span aria-hidden>·</span>}
          {messageCount > 0 && (
            <span>
              {messageCount} msg{messageCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      {id !== 'default' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Delete session"
          className="shrink-0 rounded-md p-1 text-[color:var(--color-ink-faint)] opacity-0 transition-colors hover:bg-[rgba(239,108,79,0.14)] hover:text-[color:var(--color-ember)] group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </motion.div>
  );
};
