import React, { useEffect, useRef } from 'react';
import { Workflow, Bot, Sparkles, MessageSquareText, CornerDownLeft, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Command } from './command-providers';

const KIND_ICON: Record<Command['kind'], LucideIcon> = {
    workflow: Workflow,
    agent: Bot,
    skill: Sparkles,
    prompt: MessageSquareText,
};

/**
 * The `/` command palette, rendered above the composer. Presentational — the
 * parent (ChatArea) owns the query, the active index, and keyboard nav (the keys
 * arrive on the composer textarea), and passes the already-filtered commands.
 */
export const CommandMenu = ({
    commands,
    activeIndex,
    onSelect,
    onHover,
}: {
    commands: Command[];
    activeIndex: number;
    onSelect: (c: Command) => void;
    onHover: (i: number) => void;
}) => {
    const activeRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        activeRef.current?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    if (commands.length === 0) {
        return (
            <div className="mx-auto mb-2 max-w-3xl rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] px-3 py-2.5 text-[12.5px] text-[color:var(--color-ink-faint)]">
                No matching commands.
            </div>
        );
    }

    return (
        <div className="mx-auto mb-2 max-w-3xl overflow-hidden rounded-xl border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] shadow-lg">
            <div className="max-h-[40vh] overflow-y-auto py-1">
                {commands.map((c, i) => {
                    const Icon = KIND_ICON[c.kind];
                    const active = i === activeIndex;
                    return (
                        <button
                            key={c.id}
                            ref={active ? activeRef : undefined}
                            type="button"
                            onMouseEnter={() => onHover(i)}
                            onClick={() => onSelect(c)}
                            className={cn(
                                'flex w-full items-center gap-2.5 px-3 py-1.5 text-left',
                                active ? 'bg-[rgba(244,238,228,0.06)]' : 'hover:bg-[rgba(244,238,228,0.03)]',
                            )}
                        >
                            <Icon className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-amber)]" strokeWidth={1.75} />
                            <span className="shrink-0 text-[12.5px] font-medium text-[color:var(--color-ink)]">{c.label}</span>
                            <span className="shrink-0 rounded bg-[rgba(244,238,228,0.05)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">{c.kind}</span>
                            {c.description && (
                                <span className="min-w-0 flex-1 truncate text-[12px] text-[color:var(--color-ink-faint)]">{c.description}</span>
                            )}
                            {active && <CornerDownLeft className="ml-auto h-3 w-3 shrink-0 text-[color:var(--color-ink-faint)]" />}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
