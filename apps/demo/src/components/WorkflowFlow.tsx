import React, { useMemo, useState } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    Handle,
    Position,
    MarkerType,
    type Node,
    type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '../lib/utils';
import {
    KIND_META,
    STEP_KINDS,
    ACTION_KINDS,
    ARTIFACT_KINDS,
    indexSteps,
    makeStep,
    addChild,
    toggleSlot,
    moveStep,
    removeStepById,
    changeStepKind,
    updateStepById,
    type WorkflowStep,
    type StepKind,
    type ActionKind,
    type NodeCtx,
} from './workflow-shared';

const NODE_W = 190;
const NODE_H = 46;

// ── tree → React Flow graph ───────────────────────────────────────────────────

function buildEdges(steps: WorkflowStep[]): Edge[] {
    const edges: Edge[] = [];
    let n = 0;
    const mk = (source: string, target: string, label?: string, dashed?: boolean): Edge => ({
        id: `e${n++}`,
        source,
        target,
        label,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--color-ink-faint)' },
        style: { stroke: 'var(--color-line-strong)', strokeWidth: 1.5, ...(dashed ? { strokeDasharray: '4 3' } : {}) },
        labelStyle: { fontSize: 9, fill: 'var(--color-ink-soft)' },
        labelBgStyle: { fill: 'var(--color-surface)', fillOpacity: 0.9 },
        labelBgPadding: [3, 1] as [number, number],
    });

    const children = (s: WorkflowStep) => {
        if (s.kind === 'pipeline' && s.steps) seq(s.steps, s.id, 'steps');
        s.routes?.forEach((r) => {
            edges.push(mk(s.id, r.step.id, `when: ${r.when}`, true));
            children(r.step);
        });
        s.branches?.forEach((b) => {
            edges.push(mk(s.id, b.id, '∥'));
            children(b);
        });
        if (s.aggregate) {
            edges.push(mk(s.id, s.aggregate.id, 'aggregate', true));
            children(s.aggregate);
        }
        if (s.synthesize) {
            edges.push(mk(s.id, s.synthesize.id, 'synthesize', true));
            children(s.synthesize);
        }
        if (s.generate) {
            edges.push(mk(s.id, s.generate.id, 'generate', true));
            children(s.generate);
        }
    };

    const seq = (list: WorkflowStep[], parentId?: string, parentLabel?: string) => {
        list.forEach((s, i) => {
            if (parentId && i === 0) edges.push(mk(parentId, s.id, parentLabel, true));
            if (i > 0) edges.push(mk(list[i - 1].id, s.id));
            children(s);
        });
    };

    seq(steps);
    return edges;
}

function layout(ids: string[], edges: Edge[]): Map<string, { x: number; y: number }> {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 22, ranksep: 60, marginx: 12, marginy: 12 });
    g.setDefaultEdgeLabel(() => ({}));
    ids.forEach((id) => g.setNode(id, { width: NODE_W, height: NODE_H }));
    edges.forEach((e) => g.setEdge(e.source, e.target));
    dagre.layout(g);
    const pos = new Map<string, { x: number; y: number }>();
    ids.forEach((id) => {
        const d = g.node(id);
        pos.set(id, { x: d.x - NODE_W / 2, y: d.y - NODE_H / 2 });
    });
    return pos;
}

// ── custom node ───────────────────────────────────────────────────────────────

interface WfNodeData {
    step: WorkflowStep;
    selected: boolean;
    [key: string]: unknown;
}

const WfStepNode: React.FC<{ data: WfNodeData }> = ({ data }) => {
    const meta = KIND_META[data.step.kind];
    const Icon = meta.icon;
    return (
        <div
            className={cn(
                'rounded-lg border bg-[color:var(--color-surface)] px-2.5 py-1.5 shadow-sm transition-colors',
                data.selected
                    ? 'border-[color:var(--color-amber)] ring-1 ring-[color:var(--color-amber)]'
                    : 'border-[color:var(--color-line-strong)]',
            )}
            style={{ width: NODE_W }}
        >
            <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
            <div className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-amber)]" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[color:var(--color-ink)]">
                    {data.step.title || data.step.id}
                </span>
                <span className="shrink-0 text-[9px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">{meta.label}</span>
            </div>
            <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
        </div>
    );
};

const nodeTypes = { wfstep: WfStepNode };

// ── property panel ────────────────────────────────────────────────────────────

const fieldCls =
    'w-full rounded border border-[color:var(--color-line)] bg-[color:var(--color-ground)] px-2 py-1 text-[12px] text-[color:var(--color-ink)] outline-none focus:border-[color:var(--color-amber)]';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">{label}</label>
        {children}
    </div>
);

const AddButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
    <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 rounded border border-[color:var(--color-line)] px-1.5 py-0.5 text-[11px] text-[color:var(--color-ink-soft)] hover:bg-[rgba(244,238,228,0.05)]"
    >
        <Plus className="h-3 w-3" /> {children}
    </button>
);

const StepPanel: React.FC<{
    ctx: NodeCtx;
    steps: WorkflowStep[];
    onChange: (s: WorkflowStep[]) => void;
    onSelect: (id: string | null) => void;
}> = ({ ctx, steps, onChange, onSelect }) => {
    const { step } = ctx;
    const set = (patch: Partial<WorkflowStep>) => onChange(updateStepById(steps, step.id, patch));
    const num = (v: string) => (v === '' ? undefined : Number(v));

    return (
        <div className="space-y-3 p-3">
            <div className="flex items-center gap-1">
                <span className="flex-1 text-[12px] font-semibold text-[color:var(--color-ink)]">{KIND_META[step.kind].label}</span>
                {ctx.reorderable && (
                    <>
                        <button type="button" onClick={() => onChange(moveStep(steps, step.id, 'up'))} title="Move up" className="rounded p-1 text-[color:var(--color-ink-faint)] hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]">
                            <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => onChange(moveStep(steps, step.id, 'down'))} title="Move down" className="rounded p-1 text-[color:var(--color-ink-faint)] hover:bg-[rgba(244,238,228,0.05)] hover:text-[color:var(--color-ink)]">
                            <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                    </>
                )}
                {ctx.deletable && (
                    <button
                        type="button"
                        onClick={() => {
                            onChange(removeStepById(steps, step.id));
                            onSelect(null);
                        }}
                        title="Delete"
                        className="rounded p-1 text-[color:var(--color-ink-faint)] hover:bg-[rgba(239,108,79,0.1)] hover:text-[color:var(--color-ember)]"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>

            <Field label="Kind">
                <select className={fieldCls} value={step.kind} onChange={(e) => onChange(changeStepKind(steps, step.id, e.target.value as StepKind))}>
                    {STEP_KINDS.map((k) => (
                        <option key={k} value={k}>
                            {KIND_META[k].label}
                        </option>
                    ))}
                </select>
            </Field>

            <Field label="Id">
                <input className={cn(fieldCls, 'font-mono')} value={step.id} onChange={(e) => set({ id: e.target.value })} />
            </Field>
            <Field label="Title (optional)">
                <input className={fieldCls} value={step.title ?? ''} onChange={(e) => set({ title: e.target.value || undefined })} />
            </Field>

            {step.kind === 'prompt' && (
                <>
                    <Field label="System (optional)">
                        <textarea className={cn(fieldCls, 'min-h-[44px] resize-y')} value={step.system ?? ''} onChange={(e) => set({ system: e.target.value || undefined })} />
                    </Field>
                    <Field label="Prompt">
                        <textarea className={cn(fieldCls, 'min-h-[88px] resize-y font-mono')} value={step.prompt ?? ''} onChange={(e) => set({ prompt: e.target.value })} />
                    </Field>
                    <Field label="Temperature (optional)">
                        <input type="number" step="0.1" className={fieldCls} value={step.temperature ?? ''} onChange={(e) => set({ temperature: num(e.target.value) })} />
                    </Field>
                </>
            )}

            {step.kind === 'route' && (
                <>
                    <Field label="Classify prompt">
                        <textarea className={cn(fieldCls, 'min-h-[66px] resize-y font-mono')} value={step.prompt ?? ''} onChange={(e) => set({ prompt: e.target.value })} />
                    </Field>
                    <Field label="Routes">
                        <div className="space-y-1">
                            {(step.routes ?? []).map((r, i) => (
                                <div key={i} className="flex items-center gap-1">
                                    <input
                                        className={cn(fieldCls, 'flex-1')}
                                        value={r.when}
                                        onChange={(e) =>
                                            set({ routes: (step.routes ?? []).map((x, j) => (j === i ? { ...x, when: e.target.value } : x)) })
                                        }
                                    />
                                    <button type="button" onClick={() => onSelect(r.step.id)} className="rounded px-1.5 py-0.5 text-[11px] text-[color:var(--color-amber)] hover:underline">
                                        open
                                    </button>
                                    <button type="button" onClick={() => set({ routes: (step.routes ?? []).filter((_, j) => j !== i) })} className="rounded p-1 text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ember)]">
                                        <Trash2 className="h-3 w-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className="mt-1">
                            <AddButton onClick={() => onChange(addChild(steps, step.id, 'prompt'))}>Add route</AddButton>
                        </div>
                    </Field>
                </>
            )}

            {step.kind === 'parallel' && (
                <Field label="Branches">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <AddButton onClick={() => onChange(addChild(steps, step.id, 'prompt'))}>Add branch</AddButton>
                        <button
                            type="button"
                            onClick={() => onChange(toggleSlot(steps, step.id, 'aggregate'))}
                            className={cn(
                                'rounded border px-1.5 py-0.5 text-[11px]',
                                step.aggregate
                                    ? 'border-[color:var(--color-amber)] text-[color:var(--color-amber)]'
                                    : 'border-[color:var(--color-line)] text-[color:var(--color-ink-soft)] hover:bg-[rgba(244,238,228,0.05)]',
                            )}
                        >
                            {step.aggregate ? '✓ aggregate' : '+ aggregate'}
                        </button>
                    </div>
                </Field>
            )}

            {step.kind === 'orchestrator' && (
                <>
                    <Field label="Objective">
                        <textarea className={cn(fieldCls, 'min-h-[66px] resize-y')} value={step.objective ?? ''} onChange={(e) => set({ objective: e.target.value })} />
                    </Field>
                    <Field label="Worker system (optional)">
                        <textarea className={cn(fieldCls, 'min-h-[44px] resize-y')} value={step.workerSystem ?? ''} onChange={(e) => set({ workerSystem: e.target.value || undefined })} />
                    </Field>
                    <button
                        type="button"
                        onClick={() => onChange(toggleSlot(steps, step.id, 'synthesize'))}
                        className={cn(
                            'rounded border px-1.5 py-0.5 text-[11px]',
                            step.synthesize
                                ? 'border-[color:var(--color-amber)] text-[color:var(--color-amber)]'
                                : 'border-[color:var(--color-line)] text-[color:var(--color-ink-soft)] hover:bg-[rgba(244,238,228,0.05)]',
                        )}
                    >
                        {step.synthesize ? '✓ synthesize' : '+ synthesize'}
                    </button>
                </>
            )}

            {step.kind === 'evaluator' && (
                <>
                    <Field label="Criteria">
                        <textarea className={cn(fieldCls, 'min-h-[44px] resize-y')} value={step.criteria ?? ''} onChange={(e) => set({ criteria: e.target.value })} />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                        <Field label="Threshold">
                            <input type="number" className={fieldCls} value={step.threshold ?? ''} onChange={(e) => set({ threshold: num(e.target.value) })} />
                        </Field>
                        <Field label="Max iters">
                            <input type="number" className={fieldCls} value={step.maxIterations ?? ''} onChange={(e) => set({ maxIterations: num(e.target.value) })} />
                        </Field>
                    </div>
                    <p className="text-[10.5px] text-[color:var(--color-ink-faint)]">The “generate” node (its target of optimization) is on the canvas — click it to edit.</p>
                </>
            )}

            {step.kind === 'pipeline' && (
                <Field label="Steps">
                    <AddButton onClick={() => onChange(addChild(steps, step.id, 'prompt'))}>Add step</AddButton>
                </Field>
            )}

            {step.kind === 'workflow' && (
                <>
                    <Field label="Workflow name">
                        <input className={cn(fieldCls, 'font-mono')} value={step.workflowName ?? ''} onChange={(e) => set({ workflowName: e.target.value })} />
                    </Field>
                    <p className="text-[10.5px] text-[color:var(--color-ink-faint)]">Map its inputs in the JSON tab.</p>
                </>
            )}

            {step.kind === 'action' && (() => {
                const action = step.action ?? 'create_artifact';
                const p = step.params ?? {};
                const setParam = (key: string, value: string) => set({ params: { ...p, [key]: value } });
                return (
                    <>
                        <Field label="Action">
                            <select className={fieldCls} value={action} onChange={(e) => set({ action: e.target.value as ActionKind })}>
                                {ACTION_KINDS.map((a) => (
                                    <option key={a} value={a}>{a}</option>
                                ))}
                            </select>
                        </Field>

                        {action === 'create_artifact' && (
                            <>
                                <Field label="Title">
                                    <input className={fieldCls} value={p.title ?? ''} onChange={(e) => setParam('title', e.target.value)} />
                                </Field>
                                <Field label="Artifact kind">
                                    <select className={fieldCls} value={p.kind ?? 'markdown'} onChange={(e) => setParam('kind', e.target.value)}>
                                        {ARTIFACT_KINDS.map((k) => (
                                            <option key={k} value={k}>{k}</option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="Content">
                                    <textarea className={cn(fieldCls, 'min-h-[88px] resize-y font-mono')} value={p.content ?? ''} onChange={(e) => setParam('content', e.target.value)} />
                                </Field>
                                <Field label="Summary (optional)">
                                    <input className={fieldCls} value={p.summary ?? ''} onChange={(e) => setParam('summary', e.target.value)} />
                                </Field>
                            </>
                        )}

                        {action === 'update_artifact' && (
                            <>
                                <Field label="Artifact id">
                                    <input className={cn(fieldCls, 'font-mono')} value={p.id ?? ''} onChange={(e) => setParam('id', e.target.value)} placeholder="{{steps.<createId>.id}}" />
                                </Field>
                                <Field label="Content">
                                    <textarea className={cn(fieldCls, 'min-h-[88px] resize-y font-mono')} value={p.content ?? ''} onChange={(e) => setParam('content', e.target.value)} />
                                </Field>
                                <Field label="Title (optional)">
                                    <input className={fieldCls} value={p.title ?? ''} onChange={(e) => setParam('title', e.target.value)} />
                                </Field>
                            </>
                        )}

                        {action === 'write_file' && (
                            <>
                                <Field label="Path">
                                    <input className={cn(fieldCls, 'font-mono')} value={p.path ?? ''} onChange={(e) => setParam('path', e.target.value)} placeholder="out/result.md" />
                                </Field>
                                <Field label="Content">
                                    <textarea className={cn(fieldCls, 'min-h-[88px] resize-y font-mono')} value={p.content ?? ''} onChange={(e) => setParam('content', e.target.value)} />
                                </Field>
                            </>
                        )}

                        <p className="text-[10.5px] text-[color:var(--color-ink-faint)]">
                            Params are templated — pull a prior step’s output in with <span className="font-mono">{'{{steps.id}}'}</span>.
                        </p>
                    </>
                );
            })()}
        </div>
    );
};

// ── canvas + panel ────────────────────────────────────────────────────────────

export const WorkflowFlow: React.FC<{
    steps: WorkflowStep[];
    onChange: (s: WorkflowStep[]) => void;
    /** Tailwind height class for the canvas+panel container (default h-[460px]). */
    heightClass?: string;
}> = ({ steps, onChange, heightClass = 'h-[460px]' }) => {
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const ctxMap = useMemo(() => indexSteps(steps), [steps]);
    const ids = useMemo(() => [...ctxMap.keys()], [ctxMap]);
    const edges = useMemo(() => buildEdges(steps), [steps]);

    // Relayout only when structure (ids + edges) changes — not on field edits,
    // so typing in the panel doesn't make the graph jump around.
    const structuralKey = ids.join(',') + '|' + edges.map((e) => `${e.source}>${e.target}`).join(',');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const posMap = useMemo(() => layout(ids, edges), [structuralKey]);

    const nodes: Node[] = useMemo(
        () =>
            ids.map((id) => ({
                id,
                type: 'wfstep',
                position: posMap.get(id) ?? { x: 0, y: 0 },
                data: { step: ctxMap.get(id)!.step, selected: id === selectedId },
                draggable: false,
            })),
        [ids, posMap, ctxMap, selectedId],
    );

    const selectedCtx = selectedId ? ctxMap.get(selectedId) : undefined;

    return (
        <div className={cn('flex overflow-hidden rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-ground)]', heightClass)}>
            <div className="relative flex-1">
                <div className="absolute left-2 top-2 z-10">
                    <button
                        type="button"
                        onClick={() => {
                            const s = makeStep('prompt');
                            onChange([...steps, s]);
                            setSelectedId(s.id);
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-[color:var(--color-amber)] px-2 py-1 text-[11.5px] font-medium text-[color:var(--color-ground)] shadow-sm hover:opacity-90"
                    >
                        <Plus className="h-3.5 w-3.5" /> Step
                    </button>
                </div>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    onNodeClick={(_, n) => setSelectedId(n.id)}
                    onPaneClick={() => setSelectedId(null)}
                    onNodesChange={() => { /* layout is derived from the tree */ }}
                    onEdgesChange={() => { /* edges are derived from the tree */ }}
                    nodesConnectable={false}
                    elementsSelectable
                    fitView
                    minZoom={0.2}
                    proOptions={{ hideAttribution: true }}
                    style={{ background: 'transparent' }}
                >
                    <Background color="var(--color-line)" gap={16} size={1} />
                    <Controls showInteractive={false} />
                </ReactFlow>
            </div>

            <div className="w-64 shrink-0 overflow-y-auto border-l border-[color:var(--color-line)] bg-[color:var(--color-surface)]">
                {selectedCtx ? (
                    <StepPanel ctx={selectedCtx} steps={steps} onChange={onChange} onSelect={setSelectedId} />
                ) : (
                    <div className="p-4 text-center text-[12px] leading-relaxed text-[color:var(--color-ink-faint)]">
                        {ids.length === 0 ? 'Empty workflow.' : 'Select a node to edit it.'}
                        <br />
                        Use <span className="text-[color:var(--color-amber)]">+ Step</span> to add a top-level step.
                    </div>
                )}
            </div>
        </div>
    );
};
