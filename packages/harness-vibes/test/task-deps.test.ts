import { describe, expect, test } from 'bun:test';
import { readFile } from 'fs/promises';
import { MockLanguageModelV3 } from 'ai/test';
import { join } from 'path';
import TasksPlugin from '../src/plugins/tasks';
import { createTempWorkspace, removeTempWorkspace } from './helpers';

const readTasks = async (dir: string) =>
    JSON.parse(await readFile(join(dir, 'tasks.json'), 'utf8'));

describe('task dependency DAG + editing', () => {
    test('generate_tasks resolves a non-linear DAG (two tasks share one parent)', async () => {
        const dir = await createTempWorkspace('task-dag');
        const model = new MockLanguageModelV3({
            doGenerate: async () => ({
                finishReason: { type: 'stop', unified: 'stop' },
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        tasks: [
                            { title: 'Scaffold', description: 'base' },
                            { title: 'Feature A', description: 'a', blockedBy: [0] },
                            { title: 'Feature B', description: 'b', blockedBy: [0] }, // parallel to A
                        ],
                    }),
                }],
                usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
                warnings: [],
            } as any),
        });

        try {
            const plugin = new TasksPlugin(model as any, { tasksPath: join(dir, 'tasks.json') });
            await plugin.waitReady();
            await (plugin.tools.generate_tasks as any).execute({ request: 'build it' });

            const tasks = await readTasks(dir);
            // Both A and B depend on Scaffold — not a linear A→B chain.
            expect(tasks[1].blockedBy).toEqual([tasks[0].id]);
            expect(tasks[2].blockedBy).toEqual([tasks[0].id]);
            // Scaffold blocks BOTH dependents.
            expect(new Set(tasks[0].blocks)).toEqual(new Set([tasks[1].id, tasks[2].id]));
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('update_task re-wires dependencies and recomputes status', async () => {
        const dir = await createTempWorkspace('task-rewire');
        try {
            const plugin = new TasksPlugin(undefined, { tasksPath: join(dir, 'tasks.json') });
            await plugin.waitReady();
            await (plugin.tools.create_tasks as any).execute({
                tasks: [
                    { title: 'A', description: 'a' },
                    { title: 'B', description: 'b' }, // independent → pending
                ],
            });
            let tasks = await readTasks(dir);
            const [a, b] = tasks;
            expect(b.status).toBe('pending');

            // Make B depend on A → B becomes blocked, A.blocks gains B.
            await (plugin.tools.update_task as any).execute({ id: b.id, blockedBy: [a.id] });
            tasks = await readTasks(dir);
            expect(tasks[1].blockedBy).toEqual([a.id]);
            expect(tasks[1].status).toBe('blocked');
            expect(tasks[0].blocks).toContain(b.id);

            // Completing A unblocks B (status → pending) and clears the edge.
            await (plugin.tools.update_task as any).execute({ id: a.id, status: 'completed' });
            tasks = await readTasks(dir);
            expect(tasks[1].status).toBe('pending');

            // Remove the dependency again → A.blocks no longer references B.
            await (plugin.tools.update_task as any).execute({ id: b.id, blockedBy: [] });
            tasks = await readTasks(dir);
            expect(tasks[0].blocks).not.toContain(b.id);
        } finally {
            await removeTempWorkspace(dir);
        }
    });
});
