import { cn } from '../../lib/utils';
import type { ContextUsageData } from '../data-parts/types';

const fmtK = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k` : `${Math.round(n)}`;

/**
 * Context-window meter for the composer footer — the Claude-Code-style "how
 * full is the window right now" gauge. Shows current tokens / window + the
 * percentage, a bar with a marker at the auto-compact threshold, and (on hover)
 * how much headroom is left before older turns get compacted.
 *
 * This is CURRENT occupancy (the latest model call's token count), NOT
 * cumulative session spend — it rises as the conversation grows and recedes
 * after a compaction.
 */
export const ContextGauge = ({ usage, compact = false }: { usage: ContextUsageData; compact?: boolean }) => {
  const { usedTokens, contextWindow, threshold, compressAt } = usage;
  if (!contextWindow) return null;

  const fill = Math.min(1, usedTokens / contextWindow);
  const pct = Math.round(fill * 100);
  const compressing = usedTokens >= compressAt;
  const near = usedTokens >= compressAt * 0.85;
  const remainingToCompact = Math.max(0, compressAt - usedTokens);

  const barColor = compressing
    ? 'var(--color-ember)'
    : near
      ? 'var(--color-amber)'
      : 'var(--color-moss)';

  return (
    <div
      className="flex items-center gap-1.5 font-mono text-[11px] text-[color:var(--color-ink-faint)]"
      title={
        `Context window: ${fmtK(usedTokens)} / ${fmtK(contextWindow)} tokens (${pct}%).\n` +
        `Auto-compacts at ${Math.round(threshold * 100)}% (${fmtK(compressAt)} tokens).\n` +
        (compressing
          ? 'Compacting older turns to free up room.'
          : `${fmtK(remainingToCompact)} tokens of headroom left.`)
      }
    >
      <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-[rgba(244,238,228,0.08)]">
        <span
          className="block h-full rounded-full transition-all duration-300"
          style={{ width: `${fill * 100}%`, background: barColor }}
        />
        {/* auto-compact threshold marker */}
        <span
          aria-hidden
          className="absolute top-0 h-full w-px bg-[color:var(--color-ink-soft)]"
          style={{ left: `${threshold * 100}%` }}
        />
      </span>
      <span className={cn('tabular-nums', compressing ? 'text-[color:var(--color-ember)]' : near && 'text-[color:var(--color-amber)]')}>
        {pct}%
      </span>
      {!compact && (
        <span className="text-[color:var(--color-ink-faint)]">
          {fmtK(usedTokens)}/{fmtK(contextWindow)}
        </span>
      )}
      {/* Past the auto-compact threshold → older turns get summarized on the
          next step. We label the ZONE, not an active event (the real
          compaction is shown by its own SummarizationPart when it runs). */}
      {compressing && <span className="text-[color:var(--color-ember)]">· auto-compact</span>}
    </div>
  );
};
