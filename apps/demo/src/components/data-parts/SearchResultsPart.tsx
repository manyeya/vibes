import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, type SearchData } from './types';

const COLLAPSED_COUNT = 4;

/** Best-effort hostname for display + favicon. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const SearchResultsPart: React.FC<{ data: SearchData }> = ({ data }) => {
  const [expanded, setExpanded] = useState(false);
  const results = data.results ?? [];
  const running = data.status === 'running';
  const failed = data.status === 'failed';
  const visible = expanded ? results : results.slice(0, COLLAPSED_COUNT);
  const overflow = results.length - visible.length;

  return (
    <motion.div
      {...animationProps}
      className="w-full overflow-hidden rounded-lg border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)]"
    >
      {/* Header: query + provider + status */}
      <div className="flex items-center gap-2.5 px-3 py-2">
        <Globe className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-amber)]" />
        <span className="font-mono text-[10px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">Search</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-[color:var(--color-ink)]">{data.query}</span>
        {data.provider && (
          <span className="shrink-0 rounded-md bg-[rgba(244,238,228,0.06)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">
            {data.provider}
          </span>
        )}
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[color:var(--color-amber)]" />
        ) : failed ? (
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-ember)]" />
        ) : (
          <span className="shrink-0 font-mono text-[10px] text-[color:var(--color-ink-faint)]">
            {results.length} result{results.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {failed && data.error && (
        <div className="border-t border-[color:var(--color-line)] px-3 py-2 text-[12px] text-[color:var(--color-ember)]">
          {data.error}
        </div>
      )}

      {results.length > 0 && (
        <ul className="border-t border-[color:var(--color-line)]">
          {visible.map((r, i) => {
            const host = hostOf(r.url);
            return (
              <li key={`${r.url}-${i}`} className="border-b border-[color:var(--color-line)] last:border-b-0">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex gap-2.5 px-3 py-2 transition-colors hover:bg-[rgba(244,238,228,0.035)]"
                >
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
                    alt=""
                    aria-hidden
                    className="mt-0.5 h-4 w-4 shrink-0 rounded-sm"
                    loading="lazy"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] text-[color:var(--color-ink)] group-hover:text-[color:var(--color-amber)]">
                        {r.title}
                      </span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-[color:var(--color-ink-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                    <span className="block truncate font-mono text-[10.5px] text-[color:var(--color-ink-faint)]">{host}</span>
                    {r.snippet && (
                      <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-[color:var(--color-ink-soft)]">
                        {r.snippet}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {overflow > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full px-3 py-1.5 text-left font-mono text-[11px] text-[color:var(--color-ink-faint)] transition-colors hover:text-[color:var(--color-ink-soft)]"
        >
          + {overflow} more result{overflow === 1 ? '' : 's'}
        </button>
      )}
    </motion.div>
  );
};
