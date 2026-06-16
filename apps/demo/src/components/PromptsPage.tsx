import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquareText, Plus, Trash2, RefreshCw, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';

interface SavedPrompt {
    id: string;
    name: string;
    body: string;
    tags?: string[];
    updatedAt?: string;
}

const fieldClass =
    'w-full rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-ground)] px-2.5 py-1.5 text-[13px] text-[color:var(--color-ink)] outline-none transition-colors focus:border-[color:var(--color-amber)] placeholder:text-[color:var(--color-ink-faint)]';
const labelClass = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-ink-faint)]';

const PromptCard: React.FC<{ prompt: SavedPrompt; onDelete: () => void }> = ({ prompt, onDelete }) => {
    const [open, setOpen] = useState(false);
    return (
        <section className="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)]">
            <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 p-4 text-left" aria-expanded={open}>
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[rgba(244,238,228,0.05)] text-[color:var(--color-amber)]">
                    <MessageSquareText className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <code className="truncate font-mono text-[13px] text-[color:var(--color-ink)]">/{prompt.name}</code>
                        <ChevronRight className={cn('ml-auto h-4 w-4 shrink-0 text-[color:var(--color-ink-faint)] transition-transform', open && 'rotate-90')} />
                    </div>
                    <p className={cn('mt-1 text-[12.5px] leading-relaxed text-[color:var(--color-ink-faint)]', !open && 'line-clamp-2')}>{prompt.body}</p>
                    {prompt.tags && prompt.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {prompt.tags.map((t) => (
                                <span key={t} className="rounded-md bg-[rgba(244,238,228,0.05)] px-1.5 py-0.5 text-[10.5px] text-[color:var(--color-ink-soft)]">{t}</span>
                            ))}
                        </div>
                    )}
                </div>
            </button>
            {open && (
                <div className="flex items-center justify-between gap-2 border-t border-[color:var(--color-line)] px-4 py-2.5">
                    <span className="text-[11px] text-[color:var(--color-ink-faint)]">Use it in chat: type <code className="font-mono text-[color:var(--color-amber)]">/{prompt.name}</code></span>
                    <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] text-[color:var(--color-ink-faint)] hover:bg-[rgba(239,108,79,0.1)] hover:text-[color:var(--color-ember)]">
                        <Trash2 className="h-3 w-3" /> Delete
                    </button>
                </div>
            )}
        </section>
    );
};

export const PromptsPage: React.FC = () => {
    const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [body, setBody] = useState('');
    const [tagsText, setTagsText] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/prompts');
            const data = await res.json();
            if (data.success) setPrompts(data.prompts ?? []);
            else setError(data.error || 'Failed to load prompts');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load prompts');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const save = async () => {
        if (!name.trim() || !body.trim()) return;
        setSaving(true);
        try {
            const res = await fetch('/api/prompts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), body: body.trim(), tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean) }),
            });
            const data = await res.json();
            if (data.success) { setName(''); setBody(''); setTagsText(''); await load(); }
            else setError(data.error || 'Failed to save prompt');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save prompt');
        } finally {
            setSaving(false);
        }
    };

    const remove = async (p: SavedPrompt) => {
        if (!window.confirm(`Delete prompt "${p.name}"?`)) return;
        try {
            await fetch(`/api/prompts/${p.id}`, { method: 'DELETE' });
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete prompt');
        }
    };

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-5 py-8">
                <header className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <h1 className="font-display text-[24px] leading-none text-[color:var(--color-ink)]">Prompts</h1>
                        <p className="mt-1.5 text-[13px] text-[color:var(--color-ink-soft)]">
                            Reusable prompt snippets. Type <code className="font-mono text-[color:var(--color-amber)]">/name</code> in the
                            composer to insert one.
                        </p>
                    </div>
                    <button type="button" onClick={load} title="Refresh" aria-label="Refresh" className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[color:var(--color-ink-faint)] transition-colors hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]">
                        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} strokeWidth={1.75} />
                    </button>
                </header>

                {/* New prompt */}
                <div className="mb-5 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelClass}>Name (the /command)</label>
                            <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="daily-standup" />
                        </div>
                        <div>
                            <label className={labelClass}>Tags (comma-separated)</label>
                            <input className={fieldClass} value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="review, summary" />
                        </div>
                    </div>
                    <div className="mt-3">
                        <label className={labelClass}>Prompt body</label>
                        <textarea className={cn(fieldClass, 'min-h-[90px] resize-y')} value={body} onChange={(e) => setBody(e.target.value)} placeholder="The text inserted into the composer when you pick this prompt…" />
                    </div>
                    <div className="mt-3 flex justify-end">
                        <button
                            type="button"
                            onClick={save}
                            disabled={!name.trim() || !body.trim() || saving}
                            className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-amber)] px-3 py-1.5 text-[13px] font-medium text-[color:var(--color-ground)] transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                            <Plus className="h-3.5 w-3.5" /> Save prompt
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mb-4 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-3 text-[13px] text-[color:var(--color-ink-soft)]">{error}</div>
                )}

                {!loading && prompts.length === 0 && !error && (
                    <p className="text-[13px] text-[color:var(--color-ink-faint)]">No prompts yet — save one above.</p>
                )}

                {prompts.length > 0 && (
                    <div className="space-y-3">
                        {prompts.map((p) => (
                            <PromptCard key={p.id} prompt={p} onDelete={() => remove(p)} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
