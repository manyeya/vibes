import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Workflow as WorkflowIcon, ArrowUp, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { WorkflowInput } from '../workflow-shared';

export interface RunnableWorkflow {
    id: string;
    name: string;
    description?: string;
    inputs: WorkflowInput[];
}

/**
 * A typed input form for running a saved workflow, rendered above the composer
 * (same pattern as ClarificationForm). One widget per input `type`:
 * string→text, enum→chips, number→number, boolean→Yes/No, array→tag input,
 * json→JSON textarea. Submits coerced inputs to the direct run endpoint.
 */
export const WorkflowRunForm = ({
    workflow,
    onSubmit,
    onCancel,
}: {
    workflow: RunnableWorkflow;
    onSubmit: (inputs: Record<string, unknown>) => void;
    onCancel: () => void;
}) => {
    const init: Record<string, unknown> = {};
    for (const i of workflow.inputs) {
        if (i.default !== undefined) init[i.name] = i.type === 'array' ? String(i.default).split(',').map((s) => s.trim()).filter(Boolean) : i.default;
        else if (i.type === 'array') init[i.name] = [];
        else if (i.type === 'boolean') init[i.name] = false;
    }
    const [values, setValues] = useState<Record<string, unknown>>(init);
    const [draft, setDraft] = useState<Record<string, string>>({}); // pending array-chip text
    const set = (name: string, v: unknown) => setValues((p) => ({ ...p, [name]: v }));

    const jsonValid = (name: string): boolean => {
        const v = values[name];
        if (v === undefined || v === '') return true;
        try { JSON.parse(String(v)); return true; } catch { return false; }
    };

    const filled = (i: WorkflowInput): boolean => {
        const v = values[i.name];
        if (i.type === 'array') return Array.isArray(v) && v.length > 0;
        if (i.type === 'boolean') return typeof v === 'boolean';
        return v !== undefined && v !== null && String(v).trim() !== '';
    };

    const complete = workflow.inputs.every((i) => {
        if (i.required && !filled(i)) return false;
        if (i.type === 'json' && !jsonValid(i.name)) return false;
        return true;
    });

    const submit = () => {
        if (!complete) return;
        // Fold any uncommitted array draft into the value, then submit.
        const out: Record<string, unknown> = {};
        for (const i of workflow.inputs) {
            if (i.type === 'array') {
                const chips = Array.isArray(values[i.name]) ? [...(values[i.name] as string[])] : [];
                const d = (draft[i.name] ?? '').trim();
                if (d) chips.push(d);
                if (chips.length) out[i.name] = chips;
            } else if (values[i.name] !== undefined && values[i.name] !== '') {
                out[i.name] = values[i.name];
            }
        }
        onSubmit(out);
    };

    const fieldBase =
        'w-full rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-ground)] px-3 py-1.5 text-[13px] text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-faint)] focus:border-[color:var(--color-amber)]/60 focus:outline-none';

    const renderInput = (i: WorkflowInput) => {
        const v = values[i.name];

        if (i.type === 'boolean') {
            return (
                <div className="flex gap-2">
                    {([['Yes', true], ['No', false]] as const).map(([label, val]) => (
                        <button
                            key={label}
                            type="button"
                            onClick={() => set(i.name, val)}
                            className={cn(
                                'rounded-lg border px-4 py-1.5 text-[13px] transition-colors',
                                v === val
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

        if (i.type === 'number') {
            return <input type="number" className={fieldBase} value={(v as string) ?? ''} onChange={(e) => set(i.name, e.target.value)} placeholder="Enter a number…" />;
        }

        if (i.type === 'json') {
            const ok = jsonValid(i.name);
            return (
                <>
                    <textarea rows={3} className={cn(fieldBase, 'resize-y font-mono text-[12px]', !ok && 'border-[color:var(--color-ember)]/60')} value={(v as string) ?? ''} onChange={(e) => set(i.name, e.target.value)} placeholder='{ "key": "value" }' spellCheck={false} />
                    {!ok && <p className="mt-0.5 text-[11px] text-[color:var(--color-ember)]">Invalid JSON</p>}
                </>
            );
        }

        if (i.enum && i.enum.length > 0) {
            return (
                <div className="flex flex-wrap gap-1.5">
                    {i.enum.map((opt) => (
                        <button
                            key={opt}
                            type="button"
                            onClick={() => set(i.name, opt)}
                            className={cn(
                                'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                                v === opt
                                    ? 'border-[color:var(--color-amber)]/60 bg-[rgba(224,164,88,0.1)] text-[color:var(--color-ink)]'
                                    : 'border-[color:var(--color-line)] text-[color:var(--color-ink-soft)] hover:border-[color:var(--color-line-strong)]',
                            )}
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            );
        }

        if (i.type === 'array') {
            const chips = Array.isArray(v) ? (v as string[]) : [];
            const commit = () => {
                const d = (draft[i.name] ?? '').trim();
                if (!d) return;
                set(i.name, [...chips, d]);
                setDraft((p) => ({ ...p, [i.name]: '' }));
            };
            return (
                <div className={cn(fieldBase, 'flex flex-wrap items-center gap-1.5')}>
                    {chips.map((chip, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 rounded bg-[rgba(244,238,228,0.06)] px-1.5 py-0.5 text-[12px] text-[color:var(--color-ink-soft)]">
                            {chip}
                            <button type="button" onClick={() => set(i.name, chips.filter((_, j) => j !== idx))} className="text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ember)]">
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    ))}
                    <input
                        className="min-w-[80px] flex-1 bg-transparent text-[13px] text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-faint)] focus:outline-none"
                        value={draft[i.name] ?? ''}
                        onChange={(e) => setDraft((p) => ({ ...p, [i.name]: e.target.value }))}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
                            else if (e.key === 'Backspace' && !(draft[i.name] ?? '') && chips.length) set(i.name, chips.slice(0, -1));
                        }}
                        onBlur={commit}
                        placeholder={chips.length ? 'add…' : 'type and press Enter…'}
                    />
                </div>
            );
        }

        // string
        return <input className={fieldBase} value={(v as string) ?? ''} onChange={(e) => set(i.name, e.target.value)} placeholder="Type a value…" />;
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto mb-2 max-w-3xl overflow-hidden rounded-xl border border-[color:var(--color-amber)]/45 bg-[color:var(--color-surface)]"
        >
            <div className="flex items-center gap-2 border-b border-[color:var(--color-line)] px-4 py-2.5">
                <WorkflowIcon className="h-4 w-4 shrink-0 text-[color:var(--color-amber)]" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[color:var(--color-ink)]">Run “{workflow.name}”</span>
                <button type="button" onClick={onCancel} aria-label="Cancel" className="text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)]">
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="max-h-[46vh] space-y-3.5 overflow-y-auto px-4 py-3">
                {workflow.inputs.length === 0 && <p className="text-[13px] text-[color:var(--color-ink-soft)]">No inputs — just run it.</p>}
                {workflow.inputs.map((i) => (
                    <div key={i.name}>
                        <p className="text-[13px] text-[color:var(--color-ink)]">
                            <span className="font-mono text-[color:var(--color-amber)]">{i.name}</span>
                            <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">{i.type ?? 'string'}</span>
                            {i.required && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">required</span>}
                        </p>
                        {i.description && <p className="mb-1 mt-0.5 text-[12px] text-[color:var(--color-ink-soft)]">{i.description}</p>}
                        <div className="mt-1">{renderInput(i)}</div>
                    </div>
                ))}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-[color:var(--color-line)] px-4 py-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-faint)]">{complete ? 'ready' : 'fill required inputs'}</span>
                <button
                    type="button"
                    onClick={submit}
                    disabled={!complete}
                    className={cn(
                        'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-all',
                        complete ? 'bg-[color:var(--color-amber)] text-[color:var(--color-ground)] hover:opacity-90' : 'cursor-not-allowed bg-[rgba(244,238,228,0.06)] text-[color:var(--color-ink-faint)]',
                    )}
                >
                    <ArrowUp className="h-3.5 w-3.5" /> Run workflow
                </button>
            </div>
        </motion.div>
    );
};
