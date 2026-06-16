import {
    Workflow as WorkflowIcon,
    GitBranch,
    Network,
    Boxes,
    Target,
    ListOrdered,
    MessageSquareText,
    Zap,
    type LucideIcon,
} from 'lucide-react';

// ── shared workflow types (mirror harness-vibes WorkflowPlugin JSON) ──────────

export type StepKind = 'prompt' | 'route' | 'parallel' | 'orchestrator' | 'evaluator' | 'pipeline' | 'workflow' | 'action';

/** Side-effecting actions an `action` step can trigger (no model call). */
export type ActionKind = 'create_artifact' | 'update_artifact' | 'write_file';
export const ACTION_KINDS: ActionKind[] = ['create_artifact', 'update_artifact', 'write_file'];

/** Artifact kinds a create/update_artifact action can render in the canvas. */
export const ARTIFACT_KINDS = ['html', 'markdown', 'mermaid', 'chart'] as const;

export interface WorkflowStep {
    id: string;
    kind: StepKind;
    title?: string;
    system?: string;
    prompt?: string;
    temperature?: number;
    classifySystem?: string;
    routes?: Array<{ when: string; step: WorkflowStep }>;
    branches?: WorkflowStep[];
    aggregate?: WorkflowStep;
    objective?: string;
    workerSystem?: string;
    synthesize?: WorkflowStep;
    generate?: WorkflowStep;
    criteria?: string;
    threshold?: number;
    maxIterations?: number;
    steps?: WorkflowStep[];
    workflowName?: string;
    inputs?: Record<string, string>;
    /** action step: the side-effect to perform + its templated params. */
    action?: ActionKind;
    params?: Record<string, string>;
}

export type WorkflowInputType = 'string' | 'number' | 'boolean' | 'array' | 'json';

export const WORKFLOW_INPUT_TYPES: WorkflowInputType[] = ['string', 'number', 'boolean', 'array', 'json'];

export interface WorkflowInput {
    name: string;
    description?: string;
    required?: boolean;
    type?: WorkflowInputType;
    enum?: string[];
    default?: string | number | boolean;
}

export interface WorkflowDef {
    id: string;
    name: string;
    slug?: string;
    description: string;
    tags: string[];
    inputs: WorkflowInput[];
    steps: WorkflowStep[];
    createdAt: string;
    updatedAt: string;
    version: number;
}

export const STEP_KINDS: StepKind[] = ['prompt', 'route', 'parallel', 'orchestrator', 'evaluator', 'pipeline', 'workflow', 'action'];

export const KIND_META: Record<StepKind, { icon: LucideIcon; label: string }> = {
    prompt: { icon: MessageSquareText, label: 'Prompt' },
    route: { icon: GitBranch, label: 'Route' },
    parallel: { icon: Network, label: 'Parallel' },
    orchestrator: { icon: Boxes, label: 'Orchestrator' },
    evaluator: { icon: Target, label: 'Evaluator' },
    pipeline: { icon: ListOrdered, label: 'Pipeline' },
    workflow: { icon: WorkflowIcon, label: 'Sub-workflow' },
    action: { icon: Zap, label: 'Action' },
};

export function collectKinds(steps: WorkflowStep[], into = new Set<StepKind>()): Set<StepKind> {
    for (const s of steps) {
        into.add(s.kind);
        if (s.routes) collectKinds(s.routes.map((r) => r.step), into);
        if (s.branches) collectKinds(s.branches, into);
        if (s.aggregate) collectKinds([s.aggregate], into);
        if (s.synthesize) collectKinds([s.synthesize], into);
        if (s.generate) collectKinds([s.generate], into);
        if (s.steps) collectKinds(s.steps, into);
    }
    return into;
}

// ── id + factory ──────────────────────────────────────────────────────────────

let idCounter = 0;
export function genStepId(kind: StepKind): string {
    idCounter += 1;
    return `${kind}_${Date.now().toString(36).slice(-4)}${idCounter}`;
}

/** A fresh step of a given kind, seeded with sensible defaults (incl. child slots). */
export function makeStep(kind: StepKind): WorkflowStep {
    const id = genStepId(kind);
    switch (kind) {
        case 'prompt':
            return { id, kind, prompt: 'Write about {{input.topic}}' };
        case 'route':
            return {
                id,
                kind,
                prompt: 'Classify the input',
                routes: [
                    { when: 'case_a', step: makeStep('prompt') },
                    { when: 'case_b', step: makeStep('prompt') },
                ],
            };
        case 'parallel':
            return { id, kind, branches: [makeStep('prompt'), makeStep('prompt')] };
        case 'orchestrator':
            return { id, kind, objective: 'Break down and solve the task' };
        case 'evaluator':
            return { id, kind, generate: makeStep('prompt'), criteria: 'high quality', threshold: 8, maxIterations: 3 };
        case 'pipeline':
            return { id, kind, steps: [makeStep('prompt')] };
        case 'workflow':
            return { id, kind, workflowName: '' };
        case 'action':
            return { id, kind, action: 'create_artifact', params: { title: 'Result', kind: 'markdown', content: '{{steps.draft}}' } };
    }
}

// ── node context (parent/slot, for the editor panel + edge labels) ────────────

export interface NodeCtx {
    step: WorkflowStep;
    depth: number;
    parentId?: string;
    /** How this node attaches to its parent: root | step | branch | aggregate | synthesize | generate | when:<label> */
    slot: string;
    /** Can it be deleted? (an evaluator's generate is structurally required) */
    deletable: boolean;
    /** Is it in an ordered sibling list (so up/down reordering applies)? */
    reorderable: boolean;
}

export function indexSteps(steps: WorkflowStep[]): Map<string, NodeCtx> {
    const map = new Map<string, NodeCtx>();
    const walk = (
        list: WorkflowStep[],
        parentId: string | undefined,
        slot: string,
        depth: number,
        reorderable: boolean,
        deletable: boolean,
    ) => {
        for (const step of list) {
            map.set(step.id, { step, depth, parentId, slot, deletable, reorderable });
            if (step.routes) step.routes.forEach((r) => walk([r.step], step.id, `when:${r.when}`, depth + 1, false, true));
            if (step.branches) walk(step.branches, step.id, 'branch', depth + 1, true, true);
            if (step.aggregate) walk([step.aggregate], step.id, 'aggregate', depth + 1, false, true);
            if (step.synthesize) walk([step.synthesize], step.id, 'synthesize', depth + 1, false, true);
            if (step.generate) walk([step.generate], step.id, 'generate', depth + 1, false, false);
            if (step.steps) walk(step.steps, step.id, 'step', depth + 1, true, true);
        }
    };
    walk(steps, undefined, 'root', 0, true, true);
    return map;
}

export function findStepById(steps: WorkflowStep[], id: string): WorkflowStep | undefined {
    return indexSteps(steps).get(id)?.step;
}

// ── immutable tree edits (tree stays canonical; UI ops mutate it) ─────────────

function mapChildren(step: WorkflowStep, fn: (child: WorkflowStep) => WorkflowStep): WorkflowStep {
    const s: WorkflowStep = { ...step };
    if (s.routes) s.routes = s.routes.map((r) => ({ ...r, step: fn(r.step) }));
    if (s.branches) s.branches = s.branches.map(fn);
    if (s.aggregate) s.aggregate = fn(s.aggregate);
    if (s.synthesize) s.synthesize = fn(s.synthesize);
    if (s.generate) s.generate = fn(s.generate);
    if (s.steps) s.steps = s.steps.map(fn);
    return s;
}

/** Apply `fn` to the step with `id` (and rebuild the surrounding tree immutably). */
export function transformStep(steps: WorkflowStep[], id: string, fn: (s: WorkflowStep) => WorkflowStep): WorkflowStep[] {
    const visit = (step: WorkflowStep): WorkflowStep => {
        const next = step.id === id ? fn({ ...step }) : step;
        return mapChildren(next, visit);
    };
    return steps.map(visit);
}

export function updateStepById(steps: WorkflowStep[], id: string, patch: Partial<WorkflowStep>): WorkflowStep[] {
    return transformStep(steps, id, (s) => ({ ...s, ...patch }));
}

/** Replace a step with a fresh one of a new kind, keeping id + title. */
export function changeStepKind(steps: WorkflowStep[], id: string, kind: StepKind): WorkflowStep[] {
    return transformStep(steps, id, (s) => {
        const fresh = makeStep(kind);
        fresh.id = s.id;
        if (s.title) fresh.title = s.title;
        if (s.prompt && (kind === 'prompt')) fresh.prompt = s.prompt;
        return fresh;
    });
}

/** Remove a step by id (no-op for an evaluator's required generate slot). */
export function removeStepById(steps: WorkflowStep[], id: string): WorkflowStep[] {
    const visit = (step: WorkflowStep): WorkflowStep => {
        const s: WorkflowStep = { ...step };
        if (s.routes) s.routes = s.routes.filter((r) => r.step.id !== id).map((r) => ({ ...r, step: visit(r.step) }));
        if (s.branches) s.branches = s.branches.filter((b) => b.id !== id).map(visit);
        if (s.aggregate) s.aggregate = s.aggregate.id === id ? undefined : visit(s.aggregate);
        if (s.synthesize) s.synthesize = s.synthesize.id === id ? undefined : visit(s.synthesize);
        if (s.generate) s.generate = visit(s.generate); // required — not removable
        if (s.steps) s.steps = s.steps.filter((x) => x.id !== id).map(visit);
        return s;
    };
    return steps.filter((s) => s.id !== id).map(visit);
}

/** Append a child of `kind` to a container's list slot (pipeline steps / parallel branches / route). */
export function addChild(steps: WorkflowStep[], parentId: string, kind: StepKind): WorkflowStep[] {
    return transformStep(steps, parentId, (p) => {
        const s = { ...p };
        const child = makeStep(kind);
        if (s.kind === 'pipeline') s.steps = [...(s.steps ?? []), child];
        else if (s.kind === 'parallel') s.branches = [...(s.branches ?? []), child];
        else if (s.kind === 'route') s.routes = [...(s.routes ?? []), { when: `case_${(s.routes?.length ?? 0) + 1}`, step: child }];
        return s;
    });
}

/** Toggle an optional single slot (parallel.aggregate / orchestrator.synthesize). */
export function toggleSlot(steps: WorkflowStep[], parentId: string, slot: 'aggregate' | 'synthesize'): WorkflowStep[] {
    return transformStep(steps, parentId, (p) => {
        const s = { ...p };
        s[slot] = s[slot] ? undefined : makeStep('prompt');
        return s;
    });
}

/** Reorder a step within its ordered sibling list (root / pipeline.steps / parallel.branches). */
export function moveStep(steps: WorkflowStep[], id: string, dir: 'up' | 'down'): WorkflowStep[] {
    const reorder = (list: WorkflowStep[]): WorkflowStep[] | null => {
        const idx = list.findIndex((s) => s.id === id);
        if (idx === -1) return null;
        const j = dir === 'up' ? idx - 1 : idx + 1;
        if (j < 0 || j >= list.length) return list; // at bound → unchanged
        const next = [...list];
        [next[idx], next[j]] = [next[j], next[idx]];
        return next;
    };

    const top = reorder(steps);
    if (top) return top;

    const visit = (step: WorkflowStep): WorkflowStep => {
        const s: WorkflowStep = { ...step };
        if (s.branches) {
            const r = reorder(s.branches);
            if (r) s.branches = r;
            else s.branches = s.branches.map(visit);
        }
        if (s.steps) {
            const r = reorder(s.steps);
            if (r) s.steps = r;
            else s.steps = s.steps.map(visit);
        }
        if (s.routes) s.routes = s.routes.map((rt) => ({ ...rt, step: visit(rt.step) }));
        if (s.aggregate) s.aggregate = visit(s.aggregate);
        if (s.synthesize) s.synthesize = visit(s.synthesize);
        if (s.generate) s.generate = visit(s.generate);
        return s;
    };
    return steps.map(visit);
}
