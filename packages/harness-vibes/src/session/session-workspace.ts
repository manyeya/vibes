import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

export class SessionWorkspaceStore {
    constructor(private readonly sessionsDir: string) { }

    async ensureBaseDirectory(): Promise<void> {
        await mkdir(this.sessionsDir, { recursive: true });
    }

    getPath(sessionId: string): string {
        return path.join(this.sessionsDir, sessionId);
    }

    async ensure(sessionId: string): Promise<string> {
        const workspaceDir = this.getPath(sessionId);
        await mkdir(workspaceDir, { recursive: true });
        return workspaceDir;
    }

    async delete(sessionId: string): Promise<void> {
        await rm(this.getPath(sessionId), { recursive: true, force: true });
    }

    exists(sessionId: string): boolean {
        const workspaceDir = this.getPath(sessionId);

        if (!existsSync(workspaceDir)) {
            return false;
        }

        try {
            return statSync(workspaceDir).isDirectory();
        } catch {
            return false;
        }
    }

    async export(sessionId: string): Promise<Blob> {
        if (!this.exists(sessionId)) {
            throw new Error(`Session workspace does not exist: ${sessionId}`);
        }

        const proc = Bun.spawn(['tar', '-czf', '-', '-C', this.sessionsDir, sessionId], {
            stdout: 'pipe',
            stderr: 'pipe',
        });

        const blob = await new Response(proc.stdout).blob();
        const exitCode = await proc.exited;

        if (exitCode !== 0) {
            const stderr = proc.stderr ? await new Response(proc.stderr).text() : '';
            throw new Error(`Failed to export session ${sessionId}: ${stderr || `exit code ${exitCode}`}`);
        }

        return blob;
    }

    async import(archiveData: ArrayBuffer, sessionId: string): Promise<string> {
        await this.ensureBaseDirectory();

        const targetDir = this.getPath(sessionId);
        if (this.exists(sessionId)) {
            throw new Error(`Session workspace already exists: ${sessionId}`);
        }

        const tempRoot = await mkdtemp(path.join(tmpdir(), 'harness-vibes-session-'));

        try {
            const proc = Bun.spawn(
                ['tar', '-xzf', '-', '-C', tempRoot],
                {
                    stdin: new Blob([archiveData]),
                    stderr: 'pipe',
                },
            );

            const exitCode = await proc.exited;
            if (exitCode !== 0) {
                const stderr = proc.stderr ? await new Response(proc.stderr).text() : '';
                throw new Error(`Failed to import session archive: ${stderr || `exit code ${exitCode}`}`);
            }

            const entries = await readdir(tempRoot, { withFileTypes: true });
            const directories = entries.filter((entry) => entry.isDirectory());

            if (directories.length !== 1) {
                throw new Error('Expected a single session directory in the archive');
            }

            await rename(path.join(tempRoot, directories[0].name), targetDir);
            return targetDir;
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    }
}
