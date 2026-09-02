/**
 * Background delegation registry.
 *
 * A delegated sub-agent used to block the parent's loop: `delegate`'s `execute`
 * awaited the run, so the parent could do nothing until the child finished.
 * Background tasks invert that — `delegate` registers the run here, returns a
 * task id immediately, and the parent keeps taking turns. The model pulls
 * results back in with `check_tasks` / `await_tasks`, and the loop's
 * `onBeforeFinish` hook drains anything still outstanding so a result is never
 * silently dropped.
 *
 * Deliberately not a Plugin: it owns no tools and no prompt section, it's state
 * that SubAgentPlugin holds. Kept executor-agnostic — `start` takes a runner, so
 * the same registry drives the in-process path and the Bun.spawn worker.
 */

/** Terminal state of a background run. `running` is the only non-final status. */
export type BackgroundTaskStatus = 'running' | 'complete' | 'failed';

export interface BackgroundTask<R = unknown> {
    id: string;
    agentName: string;
    /** The (truncated) task text, for `check_tasks` output. */
    task: string;
    status: BackgroundTaskStatus;
    startedAt: number;
    finishedAt?: number;
    /** The delegation result, once settled. */
    result?: R;
    /** Populated when the run threw rather than returning an error result. */
    error?: string;
}

/** What `check_tasks` reports — the task minus the internal promise/abort handles. */
export interface BackgroundTaskView<R = unknown> extends BackgroundTask<R> {
    /** Wall-clock ms the task has been running (or ran, once settled). */
    elapsedMs: number;
}

interface TaskEntry<R> extends BackgroundTask<R> {
    promise: Promise<R>;
    /** Aborts the in-process run; becomes proc.kill() for the worker executor. */
    cancel: () => void;
}

export class ConcurrencyLimitError extends Error {
    constructor(limit: number) {
        super(
            `Concurrent sub-agent limit reached (${limit} running). ` +
            `Wait for a running task with await_tasks, or check_tasks to see what's in flight.`,
        );
        this.name = 'ConcurrencyLimitError';
    }
}

export class BackgroundTaskRegistry<R = unknown> {
    private readonly tasks = new Map<string, TaskEntry<R>>();

    constructor(private readonly maxConcurrent: number) {}

    /** How many tasks are still in flight. */
    get runningCount(): number {
        let n = 0;
        for (const t of this.tasks.values()) if (t.status === 'running') n += 1;
        return n;
    }

    get hasUnsettled(): boolean {
        return this.runningCount > 0;
    }

    /**
     * Register and start a run. The returned entry is already `running`; the
     * caller gets its id back synchronously so the tool can return without
     * awaiting. Throws {@link ConcurrencyLimitError} at capacity — a spawn that
     * would exceed the cap fails loudly rather than queueing invisibly.
     */
    start(opts: {
        id: string;
        agentName: string;
        task: string;
        run: () => Promise<R>;
        cancel: () => void;
    }): BackgroundTask<R> {
        if (this.runningCount >= this.maxConcurrent) throw new ConcurrencyLimitError(this.maxConcurrent);

        const entry: TaskEntry<R> = {
            id: opts.id,
            agentName: opts.agentName,
            task: opts.task,
            status: 'running',
            startedAt: Date.now(),
            cancel: opts.cancel,
            // Assigned below; `promise` is only read after the constructor runs.
            promise: undefined as unknown as Promise<R>,
        };

        // Settle the entry in place. Never rejects: a thrown run is recorded as
        // `failed` so awaiting many tasks can't be poisoned by one of them.
        entry.promise = opts.run().then(
            (result) => {
                entry.status = 'complete';
                entry.finishedAt = Date.now();
                entry.result = result;
                return result;
            },
            (err) => {
                entry.status = 'failed';
                entry.finishedAt = Date.now();
                entry.error = err instanceof Error ? err.message : String(err);
                return undefined as unknown as R;
            },
        );

        this.tasks.set(entry.id, entry);
        return entry;
    }

    get(id: string): BackgroundTask<R> | undefined {
        return this.tasks.get(id);
    }

    /** Snapshot of every task, newest first. */
    list(): BackgroundTaskView<R>[] {
        const now = Date.now();
        return [...this.tasks.values()]
            .map(({ promise, cancel, ...t }) => ({ ...t, elapsedMs: (t.finishedAt ?? now) - t.startedAt }))
            .sort((a, b) => b.startedAt - a.startedAt);
    }

    /**
     * Block until the named tasks settle (all of them when `ids` is omitted).
     * Unknown ids are ignored rather than throwing — the model may pass a stale
     * id from an earlier turn, and that shouldn't fail the whole call.
     */
    async await(ids?: string[]): Promise<BackgroundTaskView<R>[]> {
        const targets = ids?.length
            ? ids.map((id) => this.tasks.get(id)).filter((t): t is TaskEntry<R> => t != null)
            : [...this.tasks.values()];

        await Promise.all(targets.map((t) => t.promise));

        const now = Date.now();
        return targets.map(({ promise, cancel, ...t }) => ({ ...t, elapsedMs: (t.finishedAt ?? now) - t.startedAt }));
    }

    /** Cancel one running task. Returns false if it was unknown or already settled. */
    cancel(id: string): boolean {
        const entry = this.tasks.get(id);
        if (!entry || entry.status !== 'running') return false;
        entry.cancel();
        return true;
    }

    /** Cancel everything still running — used when the parent run is aborted. */
    cancelAll(): void {
        for (const entry of this.tasks.values()) {
            if (entry.status === 'running') entry.cancel();
        }
    }
}
