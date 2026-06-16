import React, { useCallback, useEffect, useState } from 'react';
import {
    Workflow as WorkflowIcon,
    ChevronRight,
    RefreshCw,
    CornerDownRight,
    Plus,
    Pencil,
    Trash2,
    Play,
    X,
    AlertTriangle,
    Maximize2,
    Minimize2,
} from 'lucide-react';
import { WorkflowRunForm } from './chat/WorkflowRunForm';
import { cn } from '../lib/utils';
import { WorkflowFlow } from './WorkflowFlow';
import {
    KIND_META,
    collectKinds,
    WORKFLOW_INPUT_TYPES,
    type StepKind,
    type WorkflowStep,
    type WorkflowInput,
    type WorkflowDef,
} from './workflow-shared';

function timeAgo(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
}

// ── small presentational atoms ───────────────────────────────────────────────

const Chip: React.FC<{ children: React.ReactNode; accent?: boolean; className?: string }> = ({
    children,
    accent,
    className,
}) => (
    <span
        className={cn(
            'inline-flex items-center gap-1 rounded-md bg-[rgba(244,238,228,0.05)] px-1.5 py-0.5 text-[11px] font-medium',
            accent ? 'text-[color:var(--color-amber)]' : 'text-[color:var(--color-ink-soft)]',
            className,
        )}
    >
        {children}
    </span>
);

const PromptBlock: React.FC<{ text: string }> = ({ text }) => (
    <pre className="mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-[rgba(244,238,228,0.04)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[color:var(--color-ink-soft)]">
        {text}
    </pre>
);

// ── recursive step renderer ──────────────────────────────────────────────────

const StepNode: React.FC<{ step: WorkflowStep; depth?: number }> = ({ step, depth = 0 }) => {
    const meta = KIND_META[step.kind] ?? KIND_META.prompt;
    const Icon = meta.icon;
    const primary = step.prompt ?? step.objective ?? step.criteria;

    return (
        <div className={cn(depth > 0 && 'mt-2')}>
            <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[rgba(244,238,228,0.05)] text-[color:var(--color-amber)]">
                    <Icon className="h-3 w-3" strokeWidth={1.75} />
                </span>
                <span className="text-[12.5px] font-medium text-[color:var(--color-ink)]">
                    {step.title || step.id}
                </span>
                <Chip>{meta.label}</Chip>
                <code className="font-mono text-[10.5px] text-[color:var(--color-ink-faint)]">{step.id}</code>
            </div>

            <div className="ml-7 mt-1 space-y-1.5">
                {/* scalar config */}
                <div className="flex flex-wrap items-center gap-1.5">
                    {step.workflowName && (
                        <Chip accent>
                            <CornerDownRight className="h-3 w-3" /> {step.workflowName}
                        </Chip>
                    )}
                    {typeof step.threshold === 'number' && <Chip>threshold ≥ {step.threshold}</Chip>}
                    {typeof step.maxIterations === 'number' && <Chip>max {step.maxIterations}×</Chip>}
                    {typeof step.temperature === 'number' && <Chip>temp {step.temperature}</Chip>}
                    {step.inputs &&
                        Object.entries(step.inputs).map(([k, v]) => (
                            <Chip key={k}>
                                {k}={v}
                            </Chip>
                        ))}
                </div>

                {primary && <PromptBlock text={primary} />}

                {/* nested slots */}
                {step.routes && step.routes.length > 0 && (
                    <div className="space-y-1 border-l border-[color:var(--color-line)] pl-3">
                        {step.routes.map((r, i) => (
                            <div key={`${r.when}-${i}`}>
                                <Chip accent>when “{r.when}”</Chip>
                                <div className="mt-1">
                                    <StepNode step={r.step} depth={depth + 1} />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {step.branches && step.branches.length > 0 && (
                    <div className="space-y-1 border-l border-[color:var(--color-line)] pl-3">
                        {step.branches.map((b) => (
                            <StepNode key={b.id} step={b} depth={depth + 1} />
                        ))}
                    </div>
                )}

                {step.steps && step.steps.length > 0 && (
                    <div className="space-y-1 border-l border-[color:var(--color-line)] pl-3">
                        {step.steps.map((s) => (
                            <StepNode key={s.id} step={s} depth={depth + 1} />
                        ))}
                    </div>
                )}

                {step.generate && (
                    <div className="border-l border-[color:var(--color-line)] pl-3">
                        <div className="text-[10.5px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">generate</div>
                        <StepNode step={step.generate} depth={depth + 1} />
                    </div>
                )}

                {step.synthesize && (
                    <div className="border-l border-[color:var(--color-line)] pl-3">
                        <div className="text-[10.5px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">synthesize</div>
                        <StepNode step={step.synthesize} depth={depth + 1} />
                    </div>
                )}

                {step.aggregate && (
                    <div className="border-l border-[color:var(--color-line)] pl-3">
                        <div className="text-[10.5px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">aggregate</div>
                        <StepNode step={step.aggregate} depth={depth + 1} />
                    </div>
                )}
            </div>
        </div>
    );
};

// ── workflow card ────────────────────────────────────────────────────────────

const WorkflowCard: React.FC<{ workflow: WorkflowDef; onRun: () => void; onEdit: () => void; onDelete: () => void }> = ({
    workflow,
    onRun,
    onEdit,
    onDelete,
}) => {
    const [open, setOpen] = useState(false);
    const kinds = [...collectKinds(workflow.steps)];

    return (
        <section className="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)]">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-start gap-3 p-4 text-left"
                aria-expanded={open}
            >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[rgba(244,238,228,0.05)] text-[color:var(--color-amber)]">
                    <WorkflowIcon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h2 className="truncate font-display text-[15px] leading-tight text-[color:var(--color-ink)]">
                            {workflow.name}
                        </h2>
                        <Chip>v{workflow.version}</Chip>
                        <span className="ml-auto shrink-0 text-[11px] text-[color:var(--color-ink-faint)]">
                            {timeAgo(workflow.updatedAt)}
                        </span>
                        <ChevronRight
                            className={cn(
                                'h-4 w-4 shrink-0 text-[color:var(--color-ink-faint)] transition-transform',
                                open && 'rotate-90',
                            )}
                        />
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-[color:var(--color-ink-faint)]">
                        {workflow.description}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Chip>
                            {workflow.steps.length} step{workflow.steps.length === 1 ? '' : 's'}
                        </Chip>
                        {kinds.map((k) => {
                            const Icon = KIND_META[k].icon;
                            return (
                                <Chip key={k} accent>
                                    <Icon className="h-3 w-3" /> {KIND_META[k].label}
                                </Chip>
                            );
                        })}
                        {workflow.inputs.map((i) => (
                            <Chip key={i.name}>
                                {i.name}
                                {i.required ? '*' : ''}
                            </Chip>
                        ))}
                    </div>
                </div>
            </button>

            {open && (
                <div className="space-y-3 border-t border-[color:var(--color-line)] px-4 py-3.5">
                    {workflow.inputs.length > 0 && (
                        <div>
                            <div className="mb-1.5 text-[10.5px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">
                                Inputs
                            </div>
                            <div className="space-y-1">
                                {workflow.inputs.map((i) => (
                                    <div key={i.name} className="flex items-baseline gap-2 text-[12px]">
                                        <code className="font-mono text-[color:var(--color-amber)]">{i.name}</code>
                                        <span className="text-[10px] text-[color:var(--color-ink-faint)]">{i.type ?? 'string'}</span>
                                        {i.required && <span className="text-[10px] text-[color:var(--color-ink-faint)]">· required</span>}
                                        {i.enum && i.enum.length > 0 && (
                                            <span className="text-[10px] text-[color:var(--color-ink-faint)]">· {i.enum.join(' | ')}</span>
                                        )}
                                        {i.description && (
                                            <span className="text-[color:var(--color-ink-soft)]">{i.description}</span>
                                        )}
                                        {i.default !== undefined && (
                                            <span className="text-[color:var(--color-ink-faint)]">default: {String(i.default)}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div>
                        <div className="mb-1.5 text-[10.5px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">
                            Steps
                        </div>
                        <div className="space-y-3">
                            {workflow.steps.map((s) => (
                                <StepNode key={s.id} step={s} />
                            ))}
                        </div>
                    </div>

                    <div className="rounded-md bg-[rgba(244,238,228,0.04)] px-2.5 py-2">
                        <span className="text-[11px] text-[color:var(--color-ink-faint)]">Run from chat: </span>
                        <code className="font-mono text-[11px] text-[color:var(--color-ink-soft)]">
                            run_workflow("{workflow.name}"
                            {workflow.inputs.length
                                ? `, { ${workflow.inputs.map((i) => `${i.name}: "…"`).join(', ')} }`
                                : ''}
                            )
                        </code>
                    </div>

                    <div className="flex items-center gap-2 border-t border-[color:var(--color-line)] pt-3">
                        <button
                            type="button"
                            onClick={onRun}
                            className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-amber)] px-2.5 py-1 text-[12px] font-medium text-[color:var(--color-ground)] hover:opacity-90"
                        >
                            <Play className="h-3 w-3" /> Run
                        </button>
                        <button
                            type="button"
                            onClick={onEdit}
                            className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-line)] px-2.5 py-1 text-[12px] text-[color:var(--color-ink-soft)] hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]"
                        >
                            <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <button
                            type="button"
                            onClick={onDelete}
                            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] text-[color:var(--color-ink-faint)] hover:bg-[rgba(239,108,79,0.1)] hover:text-[color:var(--color-ember)]"
                        >
                            <Trash2 className="h-3 w-3" /> Delete
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
};

// ── editor (create / edit by hand) ───────────────────────────────────────────

const KINDS_REFERENCE = `prompt        { id, kind:"prompt", system?, prompt, schema?, temperature? }
route         { id, kind:"route", prompt, routes:[{ when, step }] }
parallel      { id, kind:"parallel", branches:[step], aggregate?:step }
orchestrator  { id, kind:"orchestrator", objective, workerSystem?, synthesize?:step }
evaluator     { id, kind:"evaluator", generate:step, criteria, threshold?, maxIterations? }
pipeline      { id, kind:"pipeline", steps:[step] }
workflow      { id, kind:"workflow", workflowName, inputs?:{ k:v } }

Reference data with {{input.<name>}} and {{steps.<id>}}.
aggregate / synthesize / generate accept ANY step kind — patterns nest.
Inside an evaluator's generate, {{feedback}} is the latest critique.`;

const fieldClass =
    'w-full rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-ground)] px-2.5 py-1.5 text-[13px] text-[color:var(--color-ink)] outline-none transition-colors focus:border-[color:var(--color-amber)] placeholder:text-[color:var(--color-ink-faint)]';

const labelClass = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-ink-faint)]';

// Editor metadata sidebar — drag-to-resize bounds (mirrors SessionSidebar).
const EDITOR_SIDEBAR_MIN = 280;
const EDITOR_SIDEBAR_MAX = 620;
const EDITOR_SIDEBAR_DEFAULT = 340;

interface WorkflowEditorProps {
    initial?: WorkflowDef;
    onCancel: () => void;
    onSaved: () => void;
}

const WorkflowEditor: React.FC<WorkflowEditorProps> = ({ initial, onCancel, onSaved }) => {
    const [name, setName] = useState(initial?.name ?? '');
    const [slug, setSlug] = useState(initial?.slug ?? '');
    const [description, setDescription] = useState(initial?.description ?? '');
    const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(', '));
    const [inputs, setInputs] = useState<WorkflowInput[]>(
        initial?.inputs ?? (initial ? [] : [{ name: 'topic', required: true }]),
    );
    const initialSteps: WorkflowStep[] = initial?.steps ?? [
        { id: 'draft', kind: 'prompt', prompt: 'Write a short, vivid paragraph about {{input.topic}}.' },
    ];
    const [steps, setSteps] = useState<WorkflowStep[]>(initialSteps);
    const [mode, setMode] = useState<'flow' | 'json'>('flow');
    const [jsonText, setJsonText] = useState(() => JSON.stringify(initialSteps, null, 2));
    const [jsonError, setJsonError] = useState<string | null>(null);
    const [errors, setErrors] = useState<string[]>([]);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [okMsg, setOkMsg] = useState<string | null>(null);
    const [showRef, setShowRef] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
        const saved = Number(localStorage.getItem('vibes_wf_sidebar_width'));
        return saved >= EDITOR_SIDEBAR_MIN && saved <= EDITOR_SIDEBAR_MAX ? saved : EDITOR_SIDEBAR_DEFAULT;
    });

    // Drag the sidebar's right edge to resize. Width is the cursor x measured
    // from the sidebar's own left edge, so the drag tracks the cursor exactly.
    const startSidebarResize = (e: React.MouseEvent) => {
        e.preventDefault();
        const asideLeft = (e.currentTarget as HTMLElement).closest('aside')?.getBoundingClientRect().left ?? 0;
        const clamp = (w: number) => Math.min(EDITOR_SIDEBAR_MAX, Math.max(EDITOR_SIDEBAR_MIN, w));
        let last = sidebarWidth;
        const onMove = (ev: MouseEvent) => {
            last = clamp(ev.clientX - asideLeft);
            setSidebarWidth(last);
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            localStorage.setItem('vibes_wf_sidebar_width', String(Math.round(last)));
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const setInput = (i: number, patch: Partial<WorkflowInput>) =>
        setInputs((prev) => prev.map((inp, idx) => (idx === i ? { ...inp, ...patch } : inp)));
    const addInput = () => setInputs((prev) => [...prev, { name: '' }]);
    const removeInput = (i: number) => setInputs((prev) => prev.filter((_, idx) => idx !== i));

    // The nested tree (`steps`) is canonical; the JSON tab is a synced text view.
    const switchTo = (m: 'flow' | 'json') => {
        if (m === 'json') {
            setJsonText(JSON.stringify(steps, null, 2));
            setJsonError(null);
        } else {
            try {
                const parsed = JSON.parse(jsonText);
                if (!Array.isArray(parsed)) throw new Error('Steps must be a JSON array.');
                setSteps(parsed);
                setJsonError(null);
            } catch (e) {
                setJsonError((e as Error).message);
                return; // stay on JSON until it parses
            }
        }
        setMode(m);
    };

    const onJsonChange = (text: string) => {
        setJsonText(text);
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                setSteps(parsed);
                setJsonError(null);
            } else setJsonError('Steps must be a JSON array.');
        } catch (e) {
            setJsonError((e as Error).message);
        }
    };

    // Steps to submit — commit the JSON tab if it's the active one.
    const currentSteps = (): WorkflowStep[] | null => {
        if (mode === 'json') {
            try {
                const parsed = JSON.parse(jsonText);
                if (!Array.isArray(parsed)) {
                    setErrors(['Steps must be a JSON array.']);
                    return null;
                }
                return parsed;
            } catch (e) {
                setErrors([`Invalid JSON in steps: ${(e as Error).message}`]);
                return null;
            }
        }
        return steps;
    };

    const buildBody = (steps: WorkflowStep[]) => ({
        name: name.trim(),
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        description: description.trim(),
        tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean),
        inputs: inputs
            .filter((i) => i.name.trim())
            .map((i) => ({
                name: i.name.trim(),
                ...(i.description?.trim() ? { description: i.description.trim() } : {}),
                ...(i.required ? { required: true } : {}),
                ...(i.type && i.type !== 'string' ? { type: i.type } : {}),
                ...(i.enum && i.enum.length ? { enum: i.enum } : {}),
                ...(i.default !== undefined && i.default !== '' ? { default: i.default } : {}),
            })),
        steps,
    });

    const reset = () => {
        setErrors([]);
        setWarnings([]);
        setOkMsg(null);
    };

    const validate = async () => {
        reset();
        const steps = currentSteps();
        if (!steps) return;
        setBusy(true);
        try {
            const res = await fetch('/api/workflows/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildBody(steps)),
            });
            const data = await res.json();
            setErrors(data.errors ?? []);
            setWarnings(data.warnings ?? []);
            if (data.valid && (data.errors ?? []).length === 0) setOkMsg('Looks valid ✓');
        } catch (e) {
            setErrors([(e as Error).message]);
        } finally {
            setBusy(false);
        }
    };

    const save = async () => {
        reset();
        if (!name.trim()) {
            setErrors(['Name is required.']);
            return;
        }
        const steps = currentSteps();
        if (!steps) return;
        setBusy(true);
        try {
            const res = await fetch(initial ? `/api/workflows/${initial.id}` : '/api/workflows', {
                method: initial ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(initial ? buildBody(steps) : { ...buildBody(steps), overwrite: false }),
            });
            const data = await res.json();
            if (data.success) {
                onSaved();
                return;
            }
            setErrors(data.errors ?? [data.error ?? 'Save failed']);
            setWarnings(data.warnings ?? []);
        } catch (e) {
            setErrors([(e as Error).message]);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className={cn(
                'flex flex-col overflow-hidden bg-[color:var(--color-ground)]',
                fullscreen ? 'fixed inset-0 z-[60]' : 'min-h-0 flex-1',
            )}
        >
            {/* Top bar — spans both panes */}
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--color-line)] px-5 py-3">
                <h2 className="font-display text-[18px] leading-none text-[color:var(--color-ink)]">
                    {initial ? `Edit “${initial.name}”` : 'New workflow'}
                </h2>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setFullscreen((f) => !f)}
                        aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
                        title={fullscreen ? 'Exit full screen' : 'Full screen'}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--color-ink-faint)] hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]"
                    >
                        {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        aria-label="Close editor"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--color-ink-faint)] hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </header>

            {/* Body — metadata sidebar + steps canvas */}
            <div className="flex min-h-0 flex-1">
                {/* Sidebar — workflow metadata (scrolls; actions pinned at the foot) */}
                <aside
                    style={{ width: sidebarWidth, maxWidth: '70vw' }}
                    className="relative flex shrink-0 flex-col border-r border-[color:var(--color-line)] bg-[color:var(--color-surface)]"
                >
                    {/* Drag-to-resize handle on the right edge */}
                    <div
                        onMouseDown={startSidebarResize}
                        title="Drag to resize"
                        className="group absolute right-0 top-0 z-10 h-full w-1.5 translate-x-1/2 cursor-col-resize"
                    >
                        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-[color:var(--color-amber)]" />
                    </div>
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                        <div>
                            <label className={labelClass}>Name</label>
                            <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="ship-feature" />
                        </div>
                        <div>
                            <label className={labelClass}>Slug — for /slug (optional)</label>
                            <input className={fieldClass} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="ship" />
                        </div>

                        <div>
                            <label className={labelClass}>Description</label>
                            <textarea
                                className={cn(fieldClass, 'min-h-[52px] resize-y')}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="What it does / when to use it."
                            />
                        </div>

                        <div>
                            <label className={labelClass}>Tags (comma-separated)</label>
                            <input className={fieldClass} value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="copywriting, draft" />
                        </div>

                        <div>
                            <div className="mb-1.5 flex items-center justify-between">
                                <span className={labelClass + ' mb-0'}>Inputs</span>
                                <button type="button" onClick={addInput} className="inline-flex items-center gap-1 text-[11px] text-[color:var(--color-amber)] hover:underline">
                                    <Plus className="h-3 w-3" /> Add input
                                </button>
                            </div>
                            {inputs.length === 0 && <p className="text-[12px] text-[color:var(--color-ink-faint)]">No inputs.</p>}
                            <div className="space-y-1.5">
                                {inputs.map((inp, i) => (
                                    <div key={i} className="space-y-1.5 rounded-md border border-[color:var(--color-line)] p-2">
                                        <div className="flex items-center gap-1.5">
                                            <input
                                                className={cn(fieldClass, 'flex-1')}
                                                value={inp.name}
                                                onChange={(e) => setInput(i, { name: e.target.value })}
                                                placeholder="name"
                                            />
                                            <select
                                                className={cn(fieldClass, 'w-24 shrink-0')}
                                                value={inp.type ?? 'string'}
                                                onChange={(e) => setInput(i, { type: e.target.value as WorkflowInput['type'] })}
                                            >
                                                {WORKFLOW_INPUT_TYPES.map((t) => (
                                                    <option key={t} value={t}>{t}</option>
                                                ))}
                                            </select>
                                            <label className="flex shrink-0 items-center gap-1 text-[11px] text-[color:var(--color-ink-soft)]">
                                                <input type="checkbox" checked={!!inp.required} onChange={(e) => setInput(i, { required: e.target.checked })} />
                                                req
                                            </label>
                                            <button
                                                type="button"
                                                onClick={() => removeInput(i)}
                                                aria-label="Remove input"
                                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[color:var(--color-ink-faint)] hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ember)]"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <input
                                                className={cn(fieldClass, 'flex-1')}
                                                value={inp.description ?? ''}
                                                onChange={(e) => setInput(i, { description: e.target.value })}
                                                placeholder="description (optional)"
                                            />
                                            <input
                                                className={cn(fieldClass, 'w-36 shrink-0')}
                                                value={inp.default === undefined ? '' : String(inp.default)}
                                                onChange={(e) => setInput(i, { default: e.target.value || undefined })}
                                                placeholder={
                                                    inp.type === 'array' ? 'a, b, c'
                                                        : inp.type === 'json' ? '{ }'
                                                            : inp.type === 'number' ? '0'
                                                                : inp.type === 'boolean' ? 'true'
                                                                    : 'default'
                                                }
                                            />
                                        </div>
                                        {(inp.type ?? 'string') === 'string' && (
                                            <input
                                                className={fieldClass}
                                                value={(inp.enum ?? []).join(', ')}
                                                onChange={(e) => {
                                                    const vals = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                                                    setInput(i, { enum: vals.length ? vals : undefined });
                                                }}
                                                placeholder="allowed values, comma-separated (optional)"
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {errors.length > 0 && (
                            <div className="space-y-1 rounded-md border border-[rgba(239,108,79,0.3)] bg-[rgba(239,108,79,0.08)] px-3 py-2 text-[12px] text-[color:var(--color-ember)]">
                                {errors.map((e, i) => (
                                    <div key={i} className="flex items-start gap-1.5">
                                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> <span className="break-words">{e}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {warnings.length > 0 && (
                            <div className="space-y-1 rounded-md bg-[rgba(244,238,228,0.04)] px-3 py-2 text-[12px] text-[color:var(--color-ink-soft)]">
                                {warnings.map((w, i) => (
                                    <div key={i}>⚠ {w}</div>
                                ))}
                            </div>
                        )}
                        {okMsg && <div className="text-[12px] text-[color:var(--color-moss)]">{okMsg}</div>}
                    </div>

                    {/* Pinned actions */}
                    <div className="flex shrink-0 items-center gap-2 border-t border-[color:var(--color-line)] p-3">
                        <button
                            type="button"
                            onClick={save}
                            disabled={busy}
                            className="rounded-md bg-[color:var(--color-amber)] px-3 py-1.5 text-[13px] font-medium text-[color:var(--color-ground)] transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                            {initial ? 'Save changes' : 'Create workflow'}
                        </button>
                        <button
                            type="button"
                            onClick={validate}
                            disabled={busy}
                            className="rounded-md border border-[color:var(--color-line)] px-3 py-1.5 text-[13px] text-[color:var(--color-ink-soft)] hover:bg-[rgba(244,238,228,0.05)] disabled:opacity-50"
                        >
                            Validate
                        </button>
                        <button type="button" onClick={onCancel} className="ml-auto px-3 py-1.5 text-[13px] text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)]">
                            Cancel
                        </button>
                    </div>
                </aside>

                {/* Main — steps (canvas fills the remaining space) */}
                <div className="flex min-w-0 flex-1 flex-col p-4">
                    <div className="mb-2 flex shrink-0 items-center justify-between">
                        <span className={labelClass + ' mb-0'}>Steps</span>
                        <div className="flex items-center gap-2">
                            <div className="flex rounded-md border border-[color:var(--color-line)] p-0.5 text-[11px]">
                                {(['flow', 'json'] as const).map((m) => (
                                    <button
                                        key={m}
                                        type="button"
                                        onClick={() => switchTo(m)}
                                        className={cn(
                                            'rounded px-2 py-0.5 capitalize',
                                            mode === m
                                                ? 'bg-[rgba(244,238,228,0.08)] text-[color:var(--color-ink)]'
                                                : 'text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)]',
                                        )}
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>
                            {mode === 'json' && (
                                <button type="button" onClick={() => setShowRef((v) => !v)} className="text-[11px] text-[color:var(--color-amber)] hover:underline">
                                    {showRef ? 'Hide' : 'Show'} step kinds
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col">
                        {mode === 'flow' ? (
                            <WorkflowFlow steps={steps} onChange={setSteps} heightClass="min-h-0 flex-1" />
                        ) : (
                            <>
                                {showRef && (
                                    <pre className="mb-2 max-h-44 shrink-0 overflow-auto rounded-md bg-[rgba(244,238,228,0.04)] px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-[color:var(--color-ink-soft)]">
                                        {KINDS_REFERENCE}
                                    </pre>
                                )}
                                <textarea
                                    className={cn(fieldClass, 'min-h-0 flex-1 resize-none font-mono text-[12px] leading-relaxed')}
                                    value={jsonText}
                                    onChange={(e) => onJsonChange(e.target.value)}
                                    spellCheck={false}
                                />
                                {jsonError && <p className="mt-1 shrink-0 text-[11px] text-[color:var(--color-ember)]">{jsonError}</p>}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── page ─────────────────────────────────────────────────────────────────────

export const WorkflowsPage: React.FC = () => {
    const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // null = browsing · {} = creating · { workflow } = editing.
    const [editing, setEditing] = useState<{ workflow?: WorkflowDef } | null>(null);
    const [running, setRunning] = useState<WorkflowDef | null>(null);

    // Run a workflow from the library: POST the direct endpoint against the
    // current chat session, flag it in-flight, and jump to chat to watch it.
    const runWorkflowFromPage = useCallback(async (w: WorkflowDef, inputs: Record<string, unknown>) => {
        setRunning(null);
        let sessionId = 'default';
        let model: string | undefined;
        try {
            sessionId = localStorage.getItem('vibes_session_id') || 'default';
            model = localStorage.getItem('vibes_model') || undefined;
        } catch { /* defaults */ }
        try {
            const res = await fetch(`/api/vibe/${sessionId}/workflows/${encodeURIComponent(w.name)}/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Pass the selected model so the Run button honors the UI choice
                // (else the endpoint falls back to the slow free default).
                body: JSON.stringify({ inputs, model }),
            });
            const data = await res.json().catch(() => ({}));
            if (data?.success) {
                try { localStorage.setItem(`vibes_inflight_${sessionId}`, '1'); } catch { /* ignore */ }
                window.location.hash = '#/'; // go to chat; it tails the run on arrival
            }
        } catch (err) {
            console.error('[workflows] run failed:', err);
        }
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/workflows');
            const data = await res.json();
            if (data.success) setWorkflows(data.workflows ?? []);
            else setError(data.error || 'Failed to load workflows');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load workflows');
        } finally {
            setLoading(false);
        }
    }, []);

    const handleDelete = useCallback(
        async (w: WorkflowDef) => {
            if (!window.confirm(`Delete workflow "${w.name}"? This can't be undone.`)) return;
            try {
                await fetch(`/api/workflows/${w.id}`, { method: 'DELETE' });
                await load();
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to delete workflow');
            }
        },
        [load],
    );

    useEffect(() => {
        load();
    }, [load]);

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {editing ? (
                <WorkflowEditor
                    initial={editing.workflow}
                    onCancel={() => setEditing(null)}
                    onSaved={() => {
                        setEditing(null);
                        load();
                    }}
                />
            ) : (
                <div className="flex-1 overflow-y-auto">
                    <div className="mx-auto w-full max-w-3xl px-5 py-8">
                        <header className="mb-6 flex items-start justify-between gap-4">
                            <div>
                                <h1 className="font-display text-[24px] leading-none text-[color:var(--color-ink)]">Workflows</h1>
                                <p className="mt-1.5 text-[13px] text-[color:var(--color-ink-soft)]">
                                    Saved, reusable procedures the agent can run — built from low-level AI SDK patterns
                                    (chain · route · parallel · orchestrator · evaluator).
                                </p>
                            </div>
                            <div className="mt-1 flex shrink-0 items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => setEditing({})}
                                    className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-amber)] px-2.5 py-1.5 text-[12.5px] font-medium text-[color:var(--color-ground)] transition-opacity hover:opacity-90"
                                >
                                    <Plus className="h-3.5 w-3.5" /> New
                                </button>
                                <button
                                    type="button"
                                    onClick={load}
                                    title="Refresh"
                                    aria-label="Refresh"
                                    className="flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--color-ink-faint)] transition-colors hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]"
                                >
                                    <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} strokeWidth={1.75} />
                                </button>
                            </div>
                        </header>

                        {error && (
                            <div className="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-4 text-[13px] text-[color:var(--color-ink-soft)]">
                                {error}
                            </div>
                        )}

                        {!error && loading && workflows.length === 0 && (
                            <div className="space-y-3">
                                {[0, 1, 2].map((i) => (
                                    <div
                                        key={i}
                                        className="h-24 animate-pulse rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)]"
                                    />
                                ))}
                            </div>
                        )}

                        {!error && !loading && workflows.length === 0 && (
                            <div className="rounded-xl border border-dashed border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-8 text-center">
                                <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(244,238,228,0.05)] text-[color:var(--color-amber)]">
                                    <WorkflowIcon className="h-5 w-5" strokeWidth={1.75} />
                                </span>
                                <p className="text-[14px] text-[color:var(--color-ink)]">No workflows yet</p>
                                <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-[color:var(--color-ink-faint)]">
                                    Build one by hand with “New”, or ask the agent in chat to “create a workflow that …”.
                                </p>
                            </div>
                        )}

                        {workflows.length > 0 && (
                            <div className="space-y-3">
                                {workflows.map((w) => (
                                    <WorkflowCard
                                        key={w.id}
                                        workflow={w}
                                        onRun={() => setRunning(w)}
                                        onEdit={() => setEditing({ workflow: w })}
                                        onDelete={() => handleDelete(w)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {running && (
                <div
                    className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-6"
                    onClick={() => setRunning(null)}
                >
                    <div className="mt-10 w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
                        <WorkflowRunForm
                            workflow={running}
                            onSubmit={(inputs) => runWorkflowFromPage(running, inputs)}
                            onCancel={() => setRunning(null)}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};
