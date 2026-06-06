import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { HelpCircle, ArrowUp, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ClarificationData } from '../data-parts/types';

const OTHER = '__other__';

type Answers = Record<string, { choice?: string; choices?: string[]; text?: string; other?: string }>;

/**
 * A questionnaire the agent asked, rendered above the composer. The user fills
 * it in; on submit it produces a formatted answer string that's sent back as
 * the next message. Supports single-select, multi-select and free-text, and
 * every choice question also offers a custom "Other" answer.
 */
export const ClarificationForm = ({
  clarification,
  onSubmit,
  disabled,
}: {
  clarification: ClarificationData;
  onSubmit: (text: string) => void;
  disabled?: boolean;
}) => {
  const [answers, setAnswers] = useState<Answers>({});

  const set = (qid: string, patch: Partial<Answers[string]>) =>
    setAnswers((a) => ({ ...a, [qid]: { ...a[qid], ...patch } }));

  const answerFor = (q: ClarificationData['questions'][number]): string | null => {
    const a = answers[q.id] ?? {};
    if (q.kind === 'text') return a.text?.trim() || null;
    if (q.kind === 'multi') {
      const picked = (a.choices ?? []).filter((c) => c !== OTHER);
      const other = a.choices?.includes(OTHER) ? a.other?.trim() : '';
      const all = [...picked, ...(other ? [other] : [])];
      return all.length ? all.join(', ') : null;
    }
    // single
    if (a.choice === OTHER) return a.other?.trim() || null;
    return a.choice || null;
  };

  const complete = useMemo(
    () => clarification.questions.every((q) => answerFor(q) !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answers, clarification],
  );

  const submit = () => {
    if (!complete || disabled) return;
    const lines = clarification.questions.map((q) => `- ${q.question}\n  → ${answerFor(q)}`);
    onSubmit(`Here are my answers:\n${lines.join('\n')}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto mb-2 max-w-3xl overflow-hidden rounded-xl border border-[color:var(--color-amber)]/45 bg-[color:var(--color-surface)]"
    >
      <div className="flex items-center gap-2 border-b border-[color:var(--color-line)] px-4 py-2.5">
        <HelpCircle className="h-4 w-4 shrink-0 text-[color:var(--color-amber)]" />
        <span className="text-[13px] font-medium text-[color:var(--color-ink)]">
          {clarification.title || 'A few questions before I continue'}
        </span>
      </div>

      <div className="max-h-[44vh] space-y-4 overflow-y-auto px-4 py-3">
        {clarification.questions.map((q, i) => {
          const a = answers[q.id] ?? {};
          return (
            <div key={q.id}>
              <p className="mb-1.5 text-[13px] text-[color:var(--color-ink)]">
                <span className="text-[color:var(--color-ink-faint)]">{i + 1}.</span> {q.question}
              </p>

              {q.kind === 'text' ? (
                <textarea
                  rows={2}
                  value={a.text ?? ''}
                  onChange={(e) => set(q.id, { text: e.target.value })}
                  placeholder="Type your answer…"
                  className="w-full resize-none rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-ground)] px-3 py-2 text-[13px] text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-faint)] focus:border-[color:var(--color-amber)]/60 focus:outline-none"
                />
              ) : (
                <div className="space-y-1">
                  {[...(q.options ?? []), OTHER].map((opt) => {
                    const isOther = opt === OTHER;
                    const checked =
                      q.kind === 'multi'
                        ? (a.choices ?? []).includes(opt)
                        : a.choice === opt;
                    return (
                      <label
                        key={opt}
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors',
                          checked
                            ? 'border-[color:var(--color-amber)]/60 bg-[rgba(224,164,88,0.08)] text-[color:var(--color-ink)]'
                            : 'border-[color:var(--color-line)] text-[color:var(--color-ink-soft)] hover:border-[color:var(--color-line-strong)]',
                        )}
                      >
                        <input
                          type={q.kind === 'multi' ? 'checkbox' : 'radio'}
                          name={q.id}
                          checked={checked}
                          onChange={() => {
                            if (q.kind === 'multi') {
                              const cur = new Set(a.choices ?? []);
                              cur.has(opt) ? cur.delete(opt) : cur.add(opt);
                              set(q.id, { choices: Array.from(cur) });
                            } else {
                              set(q.id, { choice: opt });
                            }
                          }}
                          className="accent-[color:var(--color-amber)]"
                        />
                        {isOther ? (
                          <input
                            value={a.other ?? ''}
                            onChange={(e) => set(q.id, { other: e.target.value })}
                            onFocus={() =>
                              q.kind === 'multi'
                                ? set(q.id, { choices: Array.from(new Set([...(a.choices ?? []), OTHER])) })
                                : set(q.id, { choice: OTHER })
                            }
                            placeholder="Other…"
                            className="min-w-0 flex-1 bg-transparent text-[13px] text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-faint)] focus:outline-none"
                          />
                        ) : (
                          <span className="min-w-0 flex-1">{opt}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[color:var(--color-line)] px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-faint)]">
          {complete ? 'ready' : 'answer to continue'}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!complete || disabled}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-all',
            complete && !disabled
              ? 'bg-[color:var(--color-amber)] text-[color:var(--color-ground)] hover:opacity-90'
              : 'cursor-not-allowed bg-[rgba(244,238,228,0.06)] text-[color:var(--color-ink-faint)]',
          )}
        >
          {complete ? <Check className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
          Send answers
        </button>
      </div>
    </motion.div>
  );
};
