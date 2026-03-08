import { describe, expect, test } from 'bun:test';
import { createPluginStreamContext } from '../src/core/types';
import { createCapturingWriter } from './helpers';

describe('DataStreamOperation', () => {
  test('emits stable ids and transient heartbeats for long-running work', async () => {
    const parts: any[] = [];
    const context = createPluginStreamContext(createCapturingWriter(parts), {
      heartbeatStartMs: 5,
      heartbeatIntervalMs: 5,
    });

    const operation = context.createOperation({
      name: 'long-task',
      toolName: 'long_task',
      plugin: 'TestPlugin',
    });

    operation.milestone('Preparing long task', { phase: 'prepare' });
    operation.progress('starting', { message: 'Starting long task', attempt: 1 });

    await Bun.sleep(14);

    operation.complete('Finished long task', { attempt: 1 });

    const milestone = parts.find(
      part => part.type === 'data-status' && part.id === `status:${operation.operationId}`,
    );
    expect(milestone).toBeDefined();
    expect(milestone.data.operationId).toBe(operation.operationId);
    expect(milestone.data.plugin).toBe('TestPlugin');

    const heartbeats = parts.filter(
      part => part.type === 'data-status' && part.id === `heartbeat:${operation.operationId}`,
    );
    expect(heartbeats.length).toBeGreaterThan(0);
    expect(heartbeats[0].transient).toBe(true);
    expect(heartbeats[0].data.phase).toBe('heartbeat');

    const toolProgress = parts.filter(
      part => part.type === 'data-tool_progress' && part.id === `tool_progress:${operation.operationId}`,
    );
    expect(toolProgress.map(part => part.data.stage)).toEqual(['starting', 'complete']);
    expect(toolProgress[1].data.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test('scopes child operations and failure metadata under the parent operation id', () => {
    const parts: any[] = [];
    const context = createPluginStreamContext(createCapturingWriter(parts));

    const parent = context.createOperation({
      name: 'parent-task',
      toolName: 'parent_tool',
      plugin: 'ParentPlugin',
    });
    const child = parent.child({
      name: 'child-task',
      toolName: 'child_tool',
    });

    child.milestone('Working child task', { phase: 'execute' });
    child.fail('child exploded', {
      toolName: 'child_tool',
      attempt: 2,
      recoverable: false,
      context: 'child test',
    });

    const childStatus = parts.find(
      part => part.type === 'data-status' && part.id === `status:${child.operationId}`,
    );
    expect(childStatus).toBeDefined();
    expect(childStatus.data.parentOperationId).toBe(parent.operationId);
    expect(childStatus.data.plugin).toBe('ParentPlugin');

    const childFailure = parts.find(
      part => part.type === 'data-tool_progress' && part.id === `tool_progress:${child.operationId}`,
    );
    expect(childFailure).toBeDefined();
    expect(childFailure.data.stage).toBe('failed');
    expect(childFailure.data.attempt).toBe(2);
    expect(childFailure.data.parentOperationId).toBe(parent.operationId);

    const childError = parts.find(
      part => part.type === 'data-error' && part.id === `error:${child.operationId}`,
    );
    expect(childError).toBeDefined();
    expect(childError.data.error).toBe('child exploded');
    expect(childError.data.parentOperationId).toBe(parent.operationId);
    expect(childError.data.context).toBe('child test');
  });
});
