import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ClipboardCheck, Check, X } from 'lucide-react';
import type { PlanReviewData } from '../data-parts/types';

const statusDot: Record<string, string> = {
  completed: 'var(--color-moss)',
  in_progress: 'var(--color-amber)',
  blocked: 'var(--color-ember)',
  failed: 'var(--color-ember)',
  pending: 'var(--color-ink-faint)',
};

const Label = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-faint)]">{children}</span>
);
const Section = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <Label>{label}</Label>
    <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--color-ink-soft)]">{children}</p>
  </div>
);

/**
 * A plan the agent put up for sign-off, rendered above the composer. Shows the
 * plan + task list and lets the user Approve or Request changes, with an
 * optional suggestions note. The decision is handed back as the next message.
 */
export const PlanReviewForm = ({
  review,
  onSubmit,
  disabled,
}: {
  review: PlanReviewData;
  onSubmit: (text: string) => void;
  disabled?: boolean;
}) => {
  const [suggestions, setSuggestions] = useState('');

  const approve = () => {
    const note = suggestions.trim();
    onSubmit(`✅ Plan approved — generate the tasks and proceed.${note ? `\n\nNote: ${note}` : ''}`);
  };
  const requestChanges = () => {
    const note = suggestions.trim();
    onSubmit(
      `✏️ Plan not approved — please revise it before proceeding.` +
        (note ? `\n\nRequested changes:\n${note}` : ' (See my notes, then send an updated plan for review.)'),
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto mb-3 max-w-3xl overflow-hidden rounded-2xl border border-[color:var(--color-amber)]/40 bg-[color:var(--color-surface)] shadow-[0_0_0_3px_rgba(240,184,108,0.06)]"
    >
      <div className="flex items-center gap-2 border-b border-[color:var(--color-line)] px-4 py-3">
        <ClipboardCheck className="h-4 w-4 shrink-0 text-[color:var(--color-amber)]" />
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-amber)]">Plan review</span>
        <span className="min-w-0 flex-1 truncate font-display text-[15px] text-[color:var(--color-ink)]">{review.title}</span>
      </div>

      <div className="max-h-[42vh] space-y-3 overflow-y-auto px-4 py-3">
        {review.note && <p className="text-[13px] italic leading-relaxed text-[color:var(--color-ink-soft)]">{review.note}</p>}
        {review.problem && <Section label="Problem">{review.problem}</Section>}
        {review.solution && <Section label="Approach">{review.solution}</Section>}

        {review.phases && review.phases.length > 0 && (
          <div>
            <Label>Phases</Label>
            <ol className="mt-1 space-y-1.5">
              {review.phases.map((ph, i) => (
                <li key={i} className="text-[13px] text-[color:var(--color-ink-soft)]">
                  <span className="text-[color:var(--color-ink)]">
                    {i + 1}. {ph.name}
                  </span>
                  {ph.goal ? ` — ${ph.goal}` : ''}
                  {ph.steps && ph.steps.length > 0 && (
                    <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-[12.5px] text-[color:var(--color-ink-faint)]">
                      {ph.steps.map((s, j) => (
                        <li key={j}>{s}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {review.tasks.length > 0 && (
          <div>
            <Label>Tasks · {review.tasks.length}</Label>
            <ul className="mt-1 space-y-1">
              {review.tasks.map((t) => (
                <li key={t.id} className="flex items-start gap-2 text-[13px] text-[color:var(--color-ink-soft)]">
                  <span
                    className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: statusDot[t.status ?? 'pending'] ?? statusDot.pending }}
                  />
                  <span className="min-w-0">{t.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {review.milestones && review.milestones.length > 0 && (
          <div>
            <Label>Milestones</Label>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-[color:var(--color-ink-soft)]">
              {review.milestones.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        {review.risks && review.risks.length > 0 && (
          <div>
            <Label>Risks</Label>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-[color:var(--color-ink-soft)]">
              {review.risks.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-[color:var(--color-line)] px-4 py-3">
        <textarea
          value={suggestions}
          onChange={(e) => setSuggestions(e.target.value)}
          placeholder="Suggestions or changes — optional to approve, recommended to request changes…"
          rows={2}
          disabled={disabled}
          className="w-full resize-none rounded-lg border border-[color:var(--color-line-strong)] bg-[color:var(--color-ground)] px-3 py-2 text-[13px] leading-relaxed text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-faint)] focus:border-[color:var(--color-amber)]/70 focus:outline-none"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={requestChanges}
            disabled={disabled}
            className="flex items-center gap-1.5 rounded-lg border border-[color:var(--color-line-strong)] px-3 py-1.5 text-[13px] text-[color:var(--color-ink-soft)] transition-colors hover:border-[color:var(--color-ember)] hover:text-[color:var(--color-ink)] disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> Request changes
          </button>
          <button
            type="button"
            onClick={approve}
            disabled={disabled}
            className="flex items-center gap-1.5 rounded-lg bg-[color:var(--color-amber)] px-3.5 py-1.5 text-[13px] font-medium text-[color:var(--color-ground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Approve plan
          </button>
        </div>
      </div>
    </motion.div>
  );
};
