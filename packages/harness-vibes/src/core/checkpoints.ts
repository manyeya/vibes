/**
 * Session checkpoints, backed by a *shadow* git repository.
 *
 * The repo's GIT_DIR lives under `~/.vibes`, but its work-tree is the user's
 * project. That separation is the whole point: we get git's snapshotting —
 * cheap diffs, exact restores, correct handling of deletes and renames — while
 * the user's own `.git` (history, index, branches, stash, reflog) is never
 * touched, and it works on a project that isn't a git repo at all.
 *
 * Why git rather than tracking edited files: this agent has a real shell, and
 * `bash.ts` runs with its cwd at the sandbox root. Anything it does — `mv`, `rm`,
 * `sed -i`, a build script writing output — never passes through
 * FilesystemPlugin's `trackFile`. Snapshotting the work-tree catches all of it
 * regardless of who wrote it. (Claude Code's checkpointing explicitly does not
 * cover bash changes for this reason.)
 *
 * Restore semantics, verified against real git:
 *   - a file captured in some checkpoint  → restored to its state at the target
 *   - a file added after the target       → removed
 *   - a file never captured in any checkpoint → left alone
 * `reset --hard` is used rather than `checkout` + `clean`: `checkout` leaves
 * later-added files behind, and `clean -fd` would delete unrelated untracked
 * files the user made by hand.
 */

import * as path from 'path';
import * as fs from 'fs/promises';

export interface Checkpoint {
    /** Short sha — the id used by the API and UI. */
    id: string;
    sha: string;
    label: string;
    createdAt: string;
}

export interface CheckpointStoreOptions {
    /** Where the shadow repo lives (under ~/.vibes, never in the project). */
    gitDir: string;
    /** The project directory being snapshotted. */
    workTree: string;
    /** Retention: keep this many most-recent checkpoints (default 100). */
    maxCheckpoints?: number;
    /**
     * Per-git-command timeout. A huge or pathological tree makes `add -A` slow;
     * we'd rather skip a checkpoint than hang the user's turn.
     */
    timeoutMs?: number;
}

/**
 * Ignored on top of the project's own `.gitignore` (which git reads from the
 * work-tree automatically). Covers the common case of a project with no
 * `.gitignore`, where `add -A` would otherwise swallow its dependencies.
 */
const DEFAULT_EXCLUDES = [
    '.git/',
    'node_modules/',
    'dist/',
    'build/',
    'out/',
    '.next/',
    '.turbo/',
    'target/',
    'vendor/',
    '__pycache__/',
    '.venv/',
    'venv/',
    '*.log',
    '.DS_Store',
];

const DEFAULT_MAX_CHECKPOINTS = 100;
const DEFAULT_TIMEOUT_MS = 30_000;

export class CheckpointStore {
    private readonly gitDir: string;
    private readonly workTree: string;
    private readonly maxCheckpoints: number;
    private readonly timeoutMs: number;
    private initialized = false;

    constructor(options: CheckpointStoreOptions) {
        this.gitDir = options.gitDir;
        this.workTree = options.workTree;
        this.maxCheckpoints = options.maxCheckpoints ?? DEFAULT_MAX_CHECKPOINTS;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    /**
     * Run a git command against the shadow repo.
     *
     * Identity and `core.bare` are passed per-invocation rather than written to
     * the repo config, so a checkpoint never depends on the user's global git
     * settings (and an unset `user.email` can't make commits fail).
     */
    private async git(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
        const proc = Bun.spawn([
            'git',
            '--git-dir', this.gitDir,
            '--work-tree', this.workTree,
            '-c', 'core.bare=false',
            '-c', 'user.email=checkpoints@vibes.local',
            '-c', 'user.name=vibes',
            '-c', `core.excludesFile=${path.join(this.gitDir, 'info', 'vibes-excludes')}`,
            ...args,
        ], { stdout: 'pipe', stderr: 'pipe', cwd: this.workTree });

        const timer = setTimeout(() => proc.kill(), this.timeoutMs);
        try {
            const [stdout, stderr, code] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
                proc.exited,
            ]);
            return { ok: code === 0, stdout, stderr };
        } finally {
            clearTimeout(timer);
        }
    }

    /** True when git exists and the work-tree is present. */
    async isAvailable(): Promise<boolean> {
        try {
            await fs.access(this.workTree);
        } catch {
            return false;
        }
        const proc = Bun.spawn(['git', '--version'], { stdout: 'ignore', stderr: 'ignore' });
        return (await proc.exited) === 0;
    }

    private async ensureInit(): Promise<boolean> {
        if (this.initialized) return true;
        try {
            await fs.mkdir(path.dirname(this.gitDir), { recursive: true });
            await fs.access(path.join(this.gitDir, 'HEAD'));
        } catch {
            const proc = Bun.spawn(['git', 'init', '--bare', '--quiet', this.gitDir], { stdout: 'ignore', stderr: 'ignore' });
            if ((await proc.exited) !== 0) return false;
        }
        // Written every init so an added default reaches existing sessions.
        await fs.mkdir(path.join(this.gitDir, 'info'), { recursive: true });
        await fs.writeFile(
            path.join(this.gitDir, 'info', 'vibes-excludes'),
            `${DEFAULT_EXCLUDES.join('\n')}\n`,
            'utf8',
        );
        this.initialized = true;
        return true;
    }

    /**
     * Snapshot the work-tree. Returns null when checkpointing isn't possible
     * (no git, missing dir, timeout) — a failed checkpoint must never fail the
     * user's turn, it just means there's no restore point for it.
     */
    async create(label: string): Promise<Checkpoint | null> {
        if (!(await this.ensureInit())) return null;

        const add = await this.git(['add', '-A']);
        if (!add.ok) return null;

        // --allow-empty: a turn that changed nothing still gets a restore point,
        // so checkpoint ids line up 1:1 with turns.
        const commit = await this.git([
            'commit', '--allow-empty', '--quiet',
            '-m', label.slice(0, 200) || 'checkpoint',
        ]);
        if (!commit.ok) return null;

        const head = await this.git(['rev-parse', 'HEAD']);
        if (!head.ok) return null;

        const sha = head.stdout.trim();
        void this.prune();
        return { id: sha.slice(0, 12), sha, label, createdAt: new Date().toISOString() };
    }

    /** Checkpoints, newest first. */
    async list(): Promise<Checkpoint[]> {
        if (!(await this.ensureInit())) return [];
        const log = await this.git(['log', '--format=%H%x00%s%x00%cI', `-${this.maxCheckpoints}`]);
        if (!log.ok) return [];
        return log.stdout
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                const [sha, label, createdAt] = line.split('\0');
                return { id: sha.slice(0, 12), sha, label: label ?? '', createdAt: createdAt ?? '' };
            });
    }

    /**
     * Restore the work-tree to a checkpoint.
     *
     * Always snapshots the CURRENT state first, so a rewind is itself
     * reversible — without that, rewinding would be the one destructive
     * operation in the system.
     */
    async restore(sha: string): Promise<{ ok: boolean; undoSha?: string; error?: string }> {
        if (!(await this.ensureInit())) return { ok: false, error: 'checkpoints unavailable' };

        const undo = await this.create(`before rewind to ${sha.slice(0, 8)}`);
        const reset = await this.git(['reset', '--hard', '--quiet', sha]);
        if (!reset.ok) return { ok: false, error: reset.stderr.trim() || 'reset failed' };
        return { ok: true, undoSha: undo?.sha };
    }

    /** Unified diff between two checkpoints (defaults to "since the beginning"). */
    async diff(fromSha: string, toSha = 'HEAD'): Promise<string> {
        if (!(await this.ensureInit())) return '';
        const out = await this.git(['diff', fromSha, toSha]);
        return out.ok ? out.stdout : '';
    }

    /** Files changed between two checkpoints. */
    async changedFiles(fromSha: string, toSha = 'HEAD'): Promise<string[]> {
        if (!(await this.ensureInit())) return [];
        const out = await this.git(['diff', '--name-only', fromSha, toSha]);
        return out.ok ? out.stdout.split('\n').filter(Boolean) : [];
    }

    /**
     * Drop history beyond the retention limit. Best-effort: the shadow repo is
     * disposable, so a failed prune is not worth surfacing.
     */
    private async prune(): Promise<void> {
        const count = await this.git(['rev-list', '--count', 'HEAD']);
        if (!count.ok) return;
        if (Number(count.stdout.trim()) <= this.maxCheckpoints) return;
        // Re-root history at the Nth-newest commit by grafting it to nothing.
        const cutoff = await this.git(['rev-parse', `HEAD~${this.maxCheckpoints}`]);
        if (!cutoff.ok) return;
        await fs.writeFile(path.join(this.gitDir, 'info', 'grafts'), `${cutoff.stdout.trim()}\n`, 'utf8')
            .catch(() => { /* best effort */ });
    }

    /** Remove the shadow repo entirely (session deleted). */
    async destroy(): Promise<void> {
        await fs.rm(this.gitDir, { recursive: true, force: true }).catch(() => { /* best effort */ });
    }
}
