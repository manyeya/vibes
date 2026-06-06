import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { HelpCircle, ArrowUp, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ClarificationData } from '../data-parts/types';

const OTHER = '__other__';
type Question = ClarificationData['questions'][number];

// The form always provides its own free-text write-in, so drop any catch-all
// option the agent tacked on ("Custom (specify)", "Other", "None of the above"…)
// to avoid a dead duplicate next to the real write-in.
const isWriteInLike = (o: string) => {
  const s = o.trim().toLowerCase();
  return (
    s.includes('specify') ||
    s.includes('write your own') ||
    s.includes('write my own') ||
    s.includes('something else') ||
    ['other', 'custom', 'none', 'n/a', 'none of the above'].includes(s)
  );
};

const multiHint = (q: Question) => {
  if (q.min && q.max) return `Select ${q.min}–${q.max}`;
  if (q.min) return `Select at least ${q.min}`;
  if (q.max) return `Select up to ${q.max}`;
  return 'Select all that apply';
};

type QA = { choice?: string; choices?: string[]; other?: string; text?: string; bool?: boolean; num?: string };
type Answers = Record<string, QA>;

/**
 * A questionnaire the agent asked, rendered above the composer. Supports
 * single / multi (with min–max) / yes-no / number / free-text questions, each
 * optionally with a description, and choice questions get a free-text "Other"
 * write-in (unless `allowCustom` is false). On submit it formats the answers
 * and hands them back as the next message.
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
  const set = (qid: string, patch: Partial<QA>) =>
    setAnswers((a) => ({ ...a, [qid]: { ...a[qid], ...patch } }));

  const realOptions = (q: Question) => (q.options ?? []).filter((o) => !isWriteInLike(o));
  const allowsCustom = (q: Question) => (q.kind === 'single' || q.kind === 'multi') && q.allowCustom !== false;

  const multiTotal = (q: Question) => {
    const a = answers[q.id] ?? {};
    const picks = (a.choices ?? []).filter((c) => c !== OTHER).length;
    const other = (a.choices ?? []).includes(OTHER) && a.other?.trim() ? 1 : 0;
    return picks + other;
  };

  const answerText = (q: Question): string => {
    const a = answers[q.id] ?? {};
    switch (q.kind) {
      case 'text':
        return a.text?.trim() ?? '';
      case 'boolean':
        return a.bool === true ? 'Yes' : a.bool === false ? 'No' : '';
      case 'number':
        return a.num?.trim() ? `${a.num.trim()}${q.unit ? ` ${q.unit}` : ''}` : '';
      case 'multi': {
        const picks = (a.choices ?? []).filter((c) => c !== OTHER);
        const other = (a.choices ?? []).includes(OTHER) ? a.other?.trim() : '';
        return [...picks, ...(other ? [other] : [])].join(', ');
      }
      default: // single
        return a.choice === OTHER ? (a.other?.trim() ?? '') : (a.choice ?? '');
    }
  };

  const isComplete = (q: Question): boolean => {
    if (q.required === false) return true;
    if (q.kind === 'multi') {
      const total = multiTotal(q);
      return total >= (q.min ?? 1) && (q.max == null || total <= q.max);
    }
    if (q.kind === 'number') {
      const n = Number((answers[q.id] ?? {}).num);
      if (!Number.isFinite(n) || !(answers[q.id]?.num ?? '').trim()) return false;
      if (q.min != null && n < q.min) return false;
      if (q.max != null && n > q.max) return false;
      return true;
    }
    return answerText(q) !== '';
  };

  const complete = useMemo(
    () => clarification.questions.every(isComplete),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answers, clarification],
  );

  const submit = () => {
    if (!complete || disabled) return;
    const lines = clarification.questions.map((q) => {
      const ans = answerText(q) || (q.required === false ? '(no preference)' : '');
      return `- ${q.question}\n  → ${ans}`;
    });
    onSubmit(`Here are my answers:\n${lines.join('\n')}`);
  };

  const renderChoices = (q: Question) => {
    const a = answers[q.id] ?? {};
    const atMax = q.kind === 'multi' && q.max != null && multiTotal(q) >= q.max;
    const list = [...realOptions(q), ...(allowsCustom(q) ? [OTHER] : [])];
    return (
      <div className="space-y-1">
        {list.map((opt) => {
          const isOther = opt === OTHER;
          const checked = q.kind === 'multi' ? (a.choices ?? []).includes(opt) : a.choice === opt;
          const lockedOut = q.kind === 'multi' && !checked && atMax;
          return (
            <label
              key={opt}
              className={cn(
                'flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors',
                checked
                  ? 'border-[color:var(--color-amber)]/60 bg-[rgba(224,164,88,0.08)] text-[color:var(--color-ink)]'
                  : 'border-[color:var(--color-line)] text-[color:var(--color-ink-soft)] hover:border-[color:var(--color-line-strong)]',
                lockedOut ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
              )}
            >
              <input
                type={q.kind === 'multi' ? 'checkbox' : 'radio'}
                name={q.id}
                checked={checked}
                disabled={lockedOut}
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
                  placeholder="Other — write your own…"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-faint)] focus:outline-none"
                />
              ) : (
                <span className="min-w-0 flex-1">{opt}</span>
              )}
            </label>
          );
        })}
      </div>
    );
  };

  const renderInput = (q: Question) => {
    const a = answers[q.id] ?? {};
    if (q.kind === 'text') {
      return (
        <textarea
          rows={2}
          value={a.text ?? ''}
          onChange={(e) => set(q.id, { text: e.target.value })}
          placeholder={q.placeholder ?? 'Type your answer…'}
          className="w-full resize-none rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-ground)] px-3 py-2 text-[13px] text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-faint)] focus:border-[color:var(--color-amber)]/60 focus:outline-none"
        />
      );
    }
    if (q.kind === 'number') {
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={a.num ?? ''}
            min={q.min}
            max={q.max}
            onChange={(e) => set(q.id, { num: e.target.value })}
            placeholder={q.placeholder ?? 'Enter a number…'}
            className="w-44 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-ground)] px-3 py-1.5 text-[13px] text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-faint)] focus:border-[color:var(--color-amber)]/60 focus:outline-none"
          />
          {q.unit && <span className="text-[12px] text-[color:var(--color-ink-soft)]">{q.unit}</span>}
        </div>
      );
    }
    if (q.kind === 'boolean') {
      return (
        <div className="flex gap-2">
          {([['Yes', true], ['No', false]] as const).map(([label, val]) => (
            <button
              key={label}
              type="button"
              onClick={() => set(q.id, { bool: val })}
              className={cn(
                'rounded-lg border px-4 py-1.5 text-[13px] transition-colors',
                a.bool === val
                  ? 'border-[color:var(--color-amber)]/60 bg-[rgba(224,164,88,0.1)] text-[color:var(--color-ink)]'
                  : 'border-[color:var(--color-line)] text-[color:var(--color-ink-soft)] hover:border-[color:var(--color-line-strong)]',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      );
    }
    return renderChoices(q);
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

      <div className="max-h-[46vh] space-y-4 overflow-y-auto px-4 py-3">
        {clarification.questions.map((q, i) => (
          <div key={q.id}>
            <p className="text-[13px] text-[color:var(--color-ink)]">
              <span className="text-[color:var(--color-ink-faint)]">{i + 1}.</span> {q.question}
              {q.required === false && (
                <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">optional</span>
              )}
            </p>
            {q.description && (
              <p className="mt-0.5 text-[12px] text-[color:var(--color-ink-soft)]">{q.description}</p>
            )}
            {q.kind === 'multi' && (
              <p className="mb-1 mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-ink-faint)]">
                {multiHint(q)}
              </p>
            )}
            <div className={cn(q.kind === 'multi' ? '' : 'mt-1.5')}>{renderInput(q)}</div>
          </div>
        ))}
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
