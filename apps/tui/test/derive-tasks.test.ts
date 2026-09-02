import { describe, expect, test } from 'bun:test';
import { deriveTasks } from '../src/derive-tasks';

const graph = (nodes: Array<[string, string, string]>) => ({
    type: 'data-task_graph',
    data: { nodes: nodes.map(([id, title, status]) => ({ id, title, status })) },
});
const update = (id: string, status: string, title?: string) => ({
    type: 'data-task_update',
    data: { id, status, ...(title ? { title } : {}) },
});
const user = (parts: any[] = []) => ({ role: 'user', parts });
const assistant = (parts: any[]) => ({ role: 'assistant', parts });

describe('deriveTasks', () => {
    test('a later graph REPLACES an earlier one (the clear_tasks case)', () => {
        // This is the bug that made a cleared list stick around forever.
        const tasks = deriveTasks([
            user(),
            assistant([graph([['t1', 'One', 'pending'], ['t2', 'Two', 'pending']])]),
            assistant([graph([])]),
        ]);
        expect(tasks).toEqual([]);
    });

    test('a smaller later graph drops tasks the earlier one had', () => {
        const tasks = deriveTasks([
            user(),
            assistant([graph([['t1', 'One', 'pending'], ['t2', 'Two', 'pending']])]),
            assistant([graph([['t2', 'Two', 'in_progress']])]),
        ]);
        expect(tasks).toEqual([{ id: 't2', title: 'Two', status: 'in_progress' }]);
    });

    test('updates after a graph override status in place', () => {
        const tasks = deriveTasks([
            user(),
            assistant([graph([['t1', 'One', 'pending']]), update('t1', 'completed')]),
        ]);
        expect(tasks).toEqual([{ id: 't1', title: 'One', status: 'completed' }]);
    });

    test('an update BEFORE the newest graph does not override it', () => {
        const tasks = deriveTasks([
            user(),
            assistant([
                graph([['t1', 'One', 'pending']]),
                update('t1', 'completed'),
                graph([['t1', 'One', 'in_progress']]),
            ]),
        ]);
        expect(tasks).toEqual([{ id: 't1', title: 'One', status: 'in_progress' }]);
    });

    test('tasks from before the last user message are ignored', () => {
        // The reported symptom: a stranded plan reappearing on a new message.
        const tasks = deriveTasks([
            user(),
            assistant([graph([['t1', 'Stranded', 'pending'], ['t2', 'Also', 'blocked']])]),
            user(),
            assistant([{ type: 'text', text: 'unrelated answer' }]),
        ]);
        expect(tasks).toEqual([]);
    });

    test('a turn with no task activity yields nothing', () => {
        expect(deriveTasks([user(), assistant([{ type: 'text', text: 'hi' }])])).toEqual([]);
    });

    test('updates with no graph still render (live task_update fallback)', () => {
        const tasks = deriveTasks([
            user(),
            assistant([update('t1', 'in_progress', 'Solo')]),
        ]);
        expect(tasks).toEqual([{ id: 't1', title: 'Solo', status: 'in_progress' }]);
    });

    test('an update for a task the current graph does not know is ignored', () => {
        const tasks = deriveTasks([
            user(),
            assistant([graph([['t1', 'One', 'pending']]), update('ghost', 'completed')]),
        ]);
        expect(tasks).toEqual([{ id: 't1', title: 'One', status: 'pending' }]);
    });

    test('handles an empty history', () => {
        expect(deriveTasks([])).toEqual([]);
    });
});
