import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
    Workflow as WorkflowIcon,
    GitBranch,
    Network,
    Boxes,
    Target,
    ListOrdered,
    MessageSquareText,
    Zap,
    Loader2,
    Check,
    X,
    CheckCircle2,
    AlertCircle,
    ChevronRight,
    Save,
    type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { animationProps, type WorkflowData } from './types';

type StepKind = NonNullable<WorkflowData['steps']>[number]['kind'];

const KIND_ICON: Record<StepKind, LucideIcon> = {
    prompt: MessageSquareText,
    route: GitBranch,
    parallel: Network,
    orchestrator: Boxes,
    evaluator: Target,
    pipeline: ListOrdered,
    workflow: WorkflowIcon,
    action: Zap,
};

const StepStatusIcon: React.FC<{ status: 'running' | 'complete' | 'failed' }> = ({ status }) => {
    if (status === 'running') return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[color:var(--color-amber)]" />;
    if (status === 'failed') return <X className="h-3 w-3 shrink-0 text-[color:var(--color-ember)]" />;
    return <Check className="h-3 w-3 shrink-0 text-[color:var(--color-moss)]" />;
};

/**
 * Live view of a workflow execution. The engine re-emits the whole run snapshot
 * (a stable-id `data-workflow` part) as each step starts/finishes, so this
 * renders an in-place-updating checklist — steps tick from spinner → check,
 * nested steps indent by depth, and the model-call counter climbs.
 */
export const WorkflowPart: React.FC<{ data: WorkflowData }> = ({ data }) => {
    const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
    const toggle = (i: number) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i);
            else next.add(i);
            return next;
        });

    // Library write — a quiet one-liner.
    if (data.action === 'saved') {
        return (
            <motion.div
                {...animationProps}
                className="flex items-center gap-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface)] px-3 py-2 text-xs text-[color:var(--color-ink-soft)]"
            >
                <Save className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-amber)]" />
                <span className="font-medium text-[color:var(--color-ink)]">Saved workflow</span>
                <code className="font-mono text-[11px]">{data.name}</code>
            </motion.div>
        );
    }

    // Execution snapshot.
    const status = data.status ?? 'running';
    const steps = data.steps ?? [];
    const HeaderIcon = status === 'running' ? Loader2 : status === 'failed' ? AlertCircle : CheckCircle2;
    const headerTone =
        status === 'failed'
            ? 'text-[color:var(--color-ember)]'
            : status === 'complete'
                ? 'text-[color:var(--color-moss)]'
                : 'text-[color:var(--color-amber)]';

    return (
        <motion.div
            {...animationProps}
            className="w-full overflow-hidden rounded-xl border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)]"
        >
            <div className="flex items-center gap-2 border-b border-[color:var(--color-line)] px-3 py-2">
                <WorkflowIcon className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-ink-faint)]" />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[color:var(--color-ink)]">{data.name}</span>
                {typeof data.modelCalls === 'number' && (
                    <span className="shrink-0 font-mono text-[10px] text-[color:var(--color-ink-faint)]">
                        {data.modelCalls} call{data.modelCalls === 1 ? '' : 's'}
                    </span>
                )}
                <HeaderIcon className={cn('h-3.5 w-3.5 shrink-0', headerTone, status === 'running' && 'animate-spin')} />
            </div>

            {steps.length > 0 && (
                <div className="space-y-0.5 px-2 py-1.5">
                    {steps.map((s, i) => {
                        const Icon = KIND_ICON[s.kind] ?? MessageSquareText;
                        const indent = (s.depth ?? 0) * 14;
                        const hasDetail = !!s.detail;
                        const open = expanded.has(i);
                        return (
                            <div key={`${s.id}-${i}`}>
                                <button
                                    type="button"
                                    onClick={() => hasDetail && toggle(i)}
                                    className={cn(
                                        'flex w-full items-center gap-1.5 py-0.5 text-left text-[11.5px]',
                                        hasDetail ? 'cursor-pointer' : 'cursor-default',
                                    )}
                                    style={{ paddingLeft: `${indent}px` }}
                                >
                                    <StepStatusIcon status={s.status} />
                                    <Icon className="h-3 w-3 shrink-0 text-[color:var(--color-ink-faint)]" />
                                    <span
                                        className={cn(
                                            'shrink-0 font-medium',
                                            s.status === 'running' ? 'text-[color:var(--color-ink)]' : 'text-[color:var(--color-ink-soft)]',
                                        )}
                                    >
                                        {s.title || s.id}
                                    </span>
                                    {s.summary && s.status !== 'running' && (
                                        <span className="min-w-0 flex-1 truncate text-[color:var(--color-ink-faint)]">— {s.summary}</span>
                                    )}
                                    {hasDetail && (
                                        <ChevronRight
                                            className={cn(
                                                'ml-auto h-3 w-3 shrink-0 text-[color:var(--color-ink-faint)] transition-transform',
                                                open && 'rotate-90',
                                            )}
                                        />
                                    )}
                                </button>
                                {open && s.detail && (
                                    <pre
                                        className="mb-1 mt-0.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-[rgba(244,238,228,0.04)] px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-[color:var(--color-ink-soft)]"
                                        style={{ marginLeft: `${indent + 18}px` }}
                                    >
                                        {s.detail}
                                    </pre>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {data.error && (
                <div className="border-t border-[color:var(--color-line)] px-3 py-2 text-[11px] text-[color:var(--color-ember)]">
                    {data.error}
                </div>
            )}
        </motion.div>
    );
};
