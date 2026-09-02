import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { join } from 'path';
import { PlanningPlugin } from '../src/plugins/planning';
import { createTempWorkspace, removeTempWorkspace } from './helpers';

describe('PlanningPlugin create_plan (generateText + Output)', () => {
    test('builds a plan from schema-validated model output', async () => {
        const dir = await createTempWorkspace('create-plan');
        const model = new MockLanguageModelV3({
            doGenerate: async () => ({
                finishReason: { type: 'stop', unified: 'stop' },
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        title: 'Ship the thing',
                        problem: 'It does not exist yet',
                        solution: 'Build it incrementally',
                        requirements: ['must persist'],
                        phases: [{ name: 'Phase 1', goal: 'scaffold', steps: ['init repo'] }],
                        milestones: ['v1 shipped'],
                        risks: ['scope creep'],
                    }),
                }],
                usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
                warnings: [],
            } as any),
        });

        try {
            const plugin = new PlanningPlugin(model as any, {
                planPath: join(dir, 'plan.md'),
                tasksPath: join(dir, 'tasks.json'),
            });
            await plugin.waitReady();

            const res = await (plugin.tools.create_plan as any).execute({ request: 'make it' });
            expect(res.success).toBe(true);
            expect(res.title).toBe('Ship the thing');
            expect(res.phases).toBe(1);
            expect(res.milestones).toBe(1);
        } finally {
            await removeTempWorkspace(dir);
        }
    });
});

describe('PlanningPlugin generate_tasks review gate', () => {
    /** A model that answers create_plan, then any task breakdown. */
    const planningModel = () => new MockLanguageModelV3({
        doGenerate: async () => ({
            finishReason: { type: 'stop', unified: 'stop' },
            content: [{
                type: 'text',
                text: JSON.stringify({
                    title: 'Ship the thing',
                    problem: 'none yet',
                    solution: 'build it',
                    phases: [{ name: 'Phase 1', goal: 'scaffold', steps: ['init repo'] }],
                    milestones: ['v1'],
                    risks: [],
                    tasks: [{ title: 'do it', description: 'the work', priority: 'medium' }],
                }),
            }],
            usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
            warnings: [],
        } as any),
    });

    test('generate_tasks is refused while an unreviewed plan exists', async () => {
        const dir = await createTempWorkspace('gate-unreviewed');
        try {
            const plugin = new PlanningPlugin(planningModel() as any, {
                planPath: join(dir, 'plan.md'),
                tasksPath: join(dir, 'tasks.json'),
            });
            await plugin.waitReady();
            await (plugin.tools.create_plan as any).execute({ request: 'make it' });

            // The plan flow's gate must not be bypassable through the other
            // task-creating tool.
            const res = await (plugin.tools.generate_tasks as any).execute({ request: 'make it' });
            expect(res.success).toBe(false);
            expect(res.error).toContain('has not been approved');
        } finally {
            await removeTempWorkspace(dir);
        }
    });

    test('generate_tasks works normally when no plan exists', async () => {
        const dir = await createTempWorkspace('gate-noplan');
        try {
            const plugin = new PlanningPlugin(planningModel() as any, {
                planPath: join(dir, 'plan.md'),
                tasksPath: join(dir, 'tasks.json'),
            });
            await plugin.waitReady();

            // No plan: still the quick-checklist tool the prompt advertises.
            const res = await (plugin.tools.generate_tasks as any).execute({ request: 'quick list' });
            expect(res.success).not.toBe(false);
        } finally {
            await removeTempWorkspace(dir);
        }
    });
});
