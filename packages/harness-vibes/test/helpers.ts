import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { tool, type Tool } from 'ai';
import z from 'zod';

export function createTool(name: string): Tool<any, any> {
  return tool({
    description: `${name} test tool`,
    inputSchema: z.object({}),
    execute: async () => ({ name }),
  });
}

export async function createTempWorkspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

export async function removeTempWorkspace(workspaceDir: string): Promise<void> {
  await rm(workspaceDir, { recursive: true, force: true });
}

export async function recordCompletion(config: { tools?: Record<string, any> }, summary = 'done', files: string[] = ['src/example.ts'], metadata?: Record<string, unknown>) {
  const completionTool = config.tools?.task_completion;
  if (!completionTool?.execute) {
    throw new Error('task_completion tool not available');
  }

  await completionTool.execute({ summary, files, metadata }, {});
}

export function completionSteps(summary = 'done', files: string[] = ['src/example.ts']) {
  return [
    {
      content: [
        {
          type: 'tool-call',
          toolCallId: 'completion-call',
          toolName: 'task_completion',
          input: { summary, files },
        },
        {
          type: 'tool-result',
          toolCallId: 'completion-call',
          toolName: 'task_completion',
          input: { summary, files },
          output: { status: 'recorded' },
        },
      ],
    },
  ];
}

export function completionThenTextSteps(summary = 'done', files: string[] = ['src/example.ts']) {
  return [
    {
      content: [
        {
          type: 'tool-call',
          toolCallId: 'completion-call',
          toolName: 'task_completion',
          input: { summary, files },
        },
        {
          type: 'tool-result',
          toolCallId: 'completion-call',
          toolName: 'task_completion',
          input: { summary, files },
          output: { status: 'recorded' },
        },
        {
          type: 'text',
          text: 'extra output after completion',
        },
      ],
    },
  ];
}
