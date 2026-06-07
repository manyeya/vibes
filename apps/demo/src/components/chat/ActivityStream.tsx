import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import type { ToolProgressData, StatusData } from '../data-parts/types';

/**
 * ActivityStream collapses noisy `data-tool_progress` (and optionally
 * `data-status` operations) into a single vertical thread keyed by
 * operationId. One row per concrete operation, mutating in place as
 * `starting → in_progress → complete | failed` updates arrive.
 *
 * Completed rows linger for COMPLETED_FADE_MS so the user can read them,
 * then auto-evict. Failed rows stick until the session is cleared.
 *
 * This replaces the old "render every chunk as its own card" path, which
 * stacked into a wall whenever the agent fan-outed several bash / list
 * operations in parallel.
 */

const COMPLETED_FADE_MS = 1800;
const MAX_VISIBLE = 8;

export interface ActivityStreamPart {
    key: string;
    type: string;
    data: unknown;
}

type Stage = 'starting' | 'in_progress' | 'complete' | 'failed';

interface ActivityRow {
    operationId: string;
    toolName: string;
    plugin?: string;
    agentName?: string;
    stage: Stage;
    message?: string;
    elapsedMs?: number;
    attempt?: number;
    firstSeen: number;
}

function extractRows(parts: ActivityStreamPart[]): ActivityRow[] {
    const map = new Map<string, ActivityRow>();
    const now = Date.now();
    for (const part of parts) {
        if (part.type !== 'data-tool_progress') continue;
        const data = part.data as ToolProgressData & { stage?: Stage };
        const opId = (data?.operationId as string | undefined) ?? part.key;
        const prev = map.get(opId);
        const stage: Stage = (data?.stage ?? prev?.stage ?? 'in_progress') as Stage;
        map.set(opId, {
            operationId: opId,
            toolName: data?.toolName ?? prev?.toolName ?? 'tool',
            plugin: data?.plugin ?? prev?.plugin,
            agentName: data?.agentName ?? prev?.agentName,
            stage,
            message: data?.message ?? prev?.message,
            elapsedMs: data?.elapsedMs ?? prev?.elapsedMs,
            attempt: data?.attempt ?? prev?.attempt,
            firstSeen: prev?.firstSeen ?? now,
        });
    }
    return Array.from(map.values()).sort((a, b) => b.firstSeen - a.firstSeen);
}

function formatElapsed(ms?: number): string | null {
    if (ms == null) return null;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * The wrapper emits generic lifecycle text ("Running list_files", "list_files
 * complete") to drive the row's state — that's noise next to the tool name. A
 * message is only worth showing if it carries real outcome ("Found 0 files",
 * "Wrote src/app.ts"). Strip the boilerplate so completed rows show the result,
 * not "<tool> complete".
 */
export function meaningfulMessage(toolName: string, message?: string): string | null {
    const m = message?.trim();
    if (!m) return null;
    const boilerplate = new Set([
        `Starting ${toolName}`,
        `Running ${toolName}`,
        `${toolName} complete`,
        `${toolName} failed`,
        `Failed: ${toolName}`,
    ]);
    if (boilerplate.has(m)) return null;
    if (m.startsWith(`Retrying ${toolName}`)) return null;
    return m;
}

const STAGE_DOT: Record<Stage, { color: string; pulse: boolean; ring?: string }> = {
    starting: { color: 'bg-[color:var(--color-amber)]', pulse: true, ring: 'ring-[color:var(--color-amber)]/30' },
    in_progress: { color: 'bg-[color:var(--color-amber)]', pulse: true, ring: 'ring-[color:var(--color-amber)]/30' },
    complete: { color: 'bg-[color:var(--color-moss)]', pulse: false },
    failed: { color: 'bg-[color:var(--color-ember)]', pulse: false },
};

const STAGE_LABEL: Record<Stage, string> = {
    starting: 'starting',
    in_progress: 'running',
    complete: 'done',
    failed: 'failed',
};

interface ActivityStreamProps {
    parts: ActivityStreamPart[];
}

export const ActivityStream: React.FC<ActivityStreamProps> = ({ parts }) => {
    const rows = useMemo(() => extractRows(parts), [parts]);
    const [evicted, setEvicted] = useState<Set<string>>(() => new Set());
    const scheduled = useRef<Set<string>>(new Set());

    useEffect(() => {
        for (const row of rows) {
            if (row.stage !== 'complete') continue;
            if (evicted.has(row.operationId)) continue;
            if (scheduled.current.has(row.operationId)) continue;
            scheduled.current.add(row.operationId);
            window.setTimeout(() => {
                setEvicted(prev => {
                    if (prev.has(row.operationId)) return prev;
                    const next = new Set(prev);
                    next.add(row.operationId);
                    return next;
                });
            }, COMPLETED_FADE_MS);
        }
    }, [rows, evicted]);

    const visible = rows.filter(r => !evicted.has(r.operationId));
    const head = visible.slice(0, MAX_VISIBLE);
    const overflow = visible.length - head.length;
    if (head.length === 0) return null;

    return (
        <div className="relative pl-3">
            {/* The vertical rail that ties the rows together */}
            <div
                aria-hidden
                className="absolute left-[5px] top-2 bottom-2 w-px bg-[color:var(--color-line-strong)]"
            />
            <ol className="space-y-1.5">
                <AnimatePresence mode="popLayout" initial={false}>
                    {head.map((row) => {
                        const dot = STAGE_DOT[row.stage];
                        const elapsed = formatElapsed(row.elapsedMs);
                        const detail = meaningfulMessage(row.toolName, row.message);
                        const agentTag = row.agentName && row.agentName !== 'vibe-agent'
                            ? row.agentName.toLowerCase()
                            : null;
                        return (
                            <motion.li
                                key={row.operationId}
                                layout
                                initial={{ opacity: 0, x: -4 }}
                                animate={{ opacity: row.stage === 'complete' ? 0.7 : 1, x: 0 }}
                                exit={{ opacity: 0, x: 8, height: 0, marginTop: 0, marginBottom: 0 }}
                                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                                className="relative flex items-center gap-3 text-[13px] leading-[18px]"
                            >
                                <span
                                    className={cn(
                                        'relative z-10 -ml-[3px] flex h-[7px] w-[7px] shrink-0 items-center justify-center rounded-full ring-2 ring-[color:var(--color-ground)]',
                                        dot.color,
                                        dot.pulse && 'dot-pulse',
                                    )}
                                />
                                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                                    <span className="font-mono text-[12.5px] tracking-tight text-[color:var(--color-ink)]">
                                        {row.toolName}
                                    </span>
                                    {agentTag && (
                                        <span className="font-mono text-[11px] text-[color:var(--color-ink-faint)]">
                                            ↳ {agentTag}
                                        </span>
                                    )}
                                    {detail && (
                                        <span className="truncate text-[12.5px] text-[color:var(--color-ink-soft)]">
                                            {detail}
                                        </span>
                                    )}
                                    {row.attempt && row.attempt > 1 && (
                                        <span className="font-mono text-[11px] text-[color:var(--color-ember)]">
                                            ×{row.attempt}
                                        </span>
                                    )}
                                </div>
                                <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-[color:var(--color-ink-faint)]">
                                    {elapsed ?? STAGE_LABEL[row.stage]}
                                </span>
                            </motion.li>
                        );
                    })}
                </AnimatePresence>
            </ol>
            {overflow > 0 && (
                <div className="mt-2 pl-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[color:var(--color-ink-faint)]">
                    + {overflow} more in flight
                </div>
            )}
        </div>
    );
};

/**
 * Lift a freeform `data-status` part to a compact thinking strip — used
 * when there is no `data-tool_progress` traffic yet but the agent is
 * still talking. Renders the most recent status message (transient ones
 * are typically heartbeats and don't appear in the input here).
 */
export const StatusStrip: React.FC<{ parts: ActivityStreamPart[] }> = ({ parts }) => {
    const last = useMemo(() => {
        for (let i = parts.length - 1; i >= 0; i--) {
            const part = parts[i];
            if (part.type !== 'data-status') continue;
            const data = part.data as StatusData | undefined;
            if (data?.message) return data;
        }
        return null;
    }, [parts]);

    if (!last) return null;

    return (
        <div className="relative overflow-hidden rounded-sm border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] px-3 py-2">
            <div className="absolute inset-x-0 bottom-0 h-px sweep-bar" aria-hidden />
            <p className="font-mono text-[12px] text-[color:var(--color-ink-soft)]">
                <span className="text-[color:var(--color-amber)]">→</span> {last.message}
            </p>
        </div>
    );
};
