import { cn } from '../../lib/utils';
import type { ContextUsageData } from '../data-parts/types';

const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k` : `${Math.round(n)}`);

/**
 * Compact context-window gauge for the composer footer: a bar filled to the
 * current token usage with a marker at the compression threshold, plus how much
 * room is left before the conversation gets compressed.
 */
export const ContextGauge = ({ usage }: { usage: ContextUsageData }) => {
  const { usedTokens, contextWindow, threshold, compressAt } = usage;
  if (!contextWindow) return null;

  const fill = Math.min(1, usedTokens / contextWindow);
  const remaining = Math.max(0, compressAt - usedTokens);
  const compressing = usedTokens >= compressAt;
  const near = usedTokens >= compressAt * 0.8;

  const barColor = compressing
    ? 'var(--color-ember)'
    : near
      ? 'var(--color-amber)'
      : 'var(--color-moss)';

  return (
    <div
      className="flex items-center gap-1.5 font-mono text-[11px] text-[color:var(--color-ink-faint)]"
      title={`${fmtK(usedTokens)} / ${fmtK(contextWindow)} tokens in context · compresses at ${Math.round(threshold * 100)}% (${fmtK(compressAt)} tokens)`}
    >
      <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-[rgba(244,238,228,0.08)]">
        <span
          className="block h-full rounded-full transition-all duration-300"
          style={{ width: `${fill * 100}%`, background: barColor }}
        />
        {/* compression threshold marker */}
        <span
          aria-hidden
          className="absolute top-0 h-full w-px bg-[color:var(--color-ink-soft)]"
          style={{ left: `${threshold * 100}%` }}
        />
      </span>
      <span className={cn(compressing && 'text-[color:var(--color-ember)]')}>
        {compressing ? 'compressing' : `${fmtK(remaining)} to compress`}
      </span>
    </div>
  );
};
