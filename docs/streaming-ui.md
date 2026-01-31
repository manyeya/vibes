# Data Streaming UI Integration

This guide explains how to use `VibesUIMessage` on the frontend to handle type-safe streaming data from the Vibes agent.

## Overview

Vibes uses the AI SDK's streaming data protocol to send real-time updates to the UI. All data types are defined in `VibesDataParts` for type safety.

## Available Data Types

| Data Type | Description | Persistent? |
|-----------|-------------|-------------|
| `data-notification` | System notifications (info/warning/error) | Transient only |
| `data-status` | Operation status updates | Persistent |
| `data-reasoning_mode` | Current reasoning mode (react/tot/plan-execute) | Persistent |
| `data-todo_update` | Todo item updates | Persistent |
| `data-task_update` | Task status updates | Persistent |
| `data-task_graph` | Task dependency graph | Persistent |
| `data-summarization` | Context compression progress | Persistent |
| `data-tool_progress` | Tool execution progress | Persistent |
| `data-error` | Error notifications | Persistent |
| `data-memory_update` | Memory system changes | Persistent |
| `data-swarm_signal` | Swarm coordination signals | Persistent |
| `data-delegation` | Sub-agent delegation updates | Persistent |

**Note:** Transient data parts (like `data-notification`) are only available via the `onData` callback and will NOT appear in `message.parts`.

## Basic Setup

```tsx
import { useChat } from '@ai-sdk/react';
import type { VibesUIMessage } from 'the-vibes';

export default function ChatPage() {
  const { messages, sendMessage, onData } = useChat<VibesUIMessage>({
    api: '/api/chat',
  });

  // ... rest of component
}
```

## Handling Streaming Data

Use the `onData` callback to handle data as it streams in:

```tsx
const { messages, sendMessage, onData } = useChat<VibesUIMessage>({
  api: '/api/chat',

  onData: (dataPart) => {
    switch (dataPart.type) {
      case 'data-notification':
        // Transient notifications (toast, alerts, etc.)
        showNotification(dataPart.data.message, dataPart.data.level);
        break;

      case 'data-status':
        // General status updates
        console.log('Status:', dataPart.data.message);
        break;

      case 'data-reasoning_mode':
        // Agent switched reasoning mode
        setReasoningMode(dataPart.data.mode);
        break;

      case 'data-task_update':
        // Task status changed
        updateTask(dataPart.data);
        break;

      case 'data-summarization':
        // Context compression happening
        console.log('Summarizing:', dataPart.data.stage);
        break;

      case 'data-tool_progress':
        // Tool is executing
        setToolProgress(dataPart.data);
        break;

      case 'data-error':
        // An error occurred
        showError(dataPart.data.error);
        break;

      case 'data-memory_update':
        // Memory was updated
        updateMemoryStats(dataPart.data);
        break;
    }
  },
});
```

## Rendering Message Parts

Persistent data parts appear in `message.parts`. Here's how to render them:

```tsx
function MessageBubble({ message }: { message: VibesUIMessage }) {
  return (
    <div className={message.role === 'user' ? 'user-message' : 'assistant-message'}>
      {/* Text content */}
      {message.parts
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part, i) => (
          <p key={i}>{part.text}</p>
        ))}

      {/* Status updates */}
      {message.parts
        .filter((part): part is { type: 'data-status' } => part.type === 'data-status')
        .map((part, i) => (
          <StatusBadge key={i}>{part.data.message}</StatusBadge>
        ))}

      {/* Task updates */}
      {message.parts
        .filter((part): part is { type: 'data-task_update' } => part.type === 'data-task_update')
        .map((part, i) => (
          <TaskBadge key={i} status={part.data.status}>
            {part.data.title}
          </TaskBadge>
        ))}

      {/* Tool progress */}
      {message.parts
        .filter((part): part is { type: 'data-tool_progress' } => part.type === 'data-tool_progress')
        .map((part, i) => (
          <ProgressBar key={i} tool={part.data.toolName} progress={part.data.progress} />
        ))}

      {/* Errors */}
      {message.parts
        .filter((part): part is { type: 'data-error' } => part.type === 'data-error')
        .map((part, i) => (
          <ErrorAlert key={i}>{part.data.error}</ErrorAlert>
        ))}
    </div>
  );
}
```

## Complete Example with Agent Status Panel

```tsx
import { useChat } from '@ai-sdk/react';
import type { VibesUIMessage } from 'the-vibes';
import { useState } from 'react';

interface AgentStatus {
  reasoningMode: 'react' | 'tot' | 'plan-execute';
  isProcessing: boolean;
  tokenCount: number;
  tasks: Task[];
  lessonsLearned: number;
  factsStored: number;
  patternsCount: number;
}

export default function ChatPage() {
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    reasoningMode: 'react',
    isProcessing: false,
    tokenCount: 0,
    tasks: [],
    lessonsLearned: 0,
    factsStored: 0,
    patternsCount: 0,
  });

  const { messages, sendMessage } = useChat<VibesUIMessage>({
    api: '/api/chat',

    onData: (dataPart) => {
      switch (dataPart.type) {
        case 'data-reasoning_mode':
          setAgentStatus(prev => ({ ...prev, reasoningMode: dataPart.data.mode }));
          break;

        case 'data-status':
          const msg = dataPart.data.message;
          if (msg.includes('Lesson saved')) {
            setAgentStatus(prev => ({ ...prev, lessonsLearned: prev.lessonsLearned + 1 }));
          }
          if (msg.includes('Fact remembered')) {
            setAgentStatus(prev => ({ ...prev, factsStored: prev.factsStored + 1 }));
          }
          if (msg.includes('Pattern saved')) {
            setAgentStatus(prev => ({ ...prev, patternsCount: prev.patternsCount + 1 }));
          }
          break;

        case 'data-task_update':
          setAgentStatus(prev => ({
            ...prev,
            tasks: prev.tasks.some(t => t.id === dataPart.data.id)
              ? prev.tasks.map(t => t.id === dataPart.data.id ? { ...t, ...dataPart.data } : t)
              : [...prev.tasks, dataPart.data],
          }));
          break;
      }
    },
  });

  return (
    <div className="flex h-screen">
      {/* Main chat area */}
      <main className="flex-1">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </main>

      {/* Agent Status Panel */}
      <aside className="w-80 border-l p-4">
        <h2>Agent Status</h2>

        <div className="mb-4">
          <span className="text-sm">Reasoning Mode</span>
          <span className="ml-2">{agentStatus.reasoningMode}</span>
        </div>

        <div className="mb-4">
          <span className="text-sm">Memory</span>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>{agentStatus.lessonsLearned} Lessons</div>
            <div>{agentStatus.factsStored} Facts</div>
            <div>{agentStatus.patternsCount} Patterns</div>
          </div>
        </div>

        <div>
          <span className="text-sm">Tasks</span>
          {agentStatus.tasks.map(task => (
            <div key={task.id} className="flex items-center gap-2">
              <span className={
                task.status === 'completed' ? 'text-green' :
                task.status === 'in_progress' ? 'text-yellow' : 'text-gray'
              }>
                {task.status === 'completed' ? '✓' : '○'}
              </span>
              <span>{task.title}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
```

## Type Reference

```typescript
interface VibesDataParts {
  notification: {
    message: string;
    level: 'info' | 'warning' | 'error';
  };
  status: {
    message: string;
    step?: number;
    totalSteps?: number;
  };
  reasoning_mode: {
    mode: 'react' | 'tot' | 'plan-execute';
  };
  todo_update: {
    id: string;
    status: 'pending' | 'in_progress' | 'completed';
    title?: string;
  };
  task_update: {
    id: string;
    status: 'pending' | 'blocked' | 'in_progress' | 'completed' | 'failed';
    title?: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    error?: string;
  };
  task_graph: {
    nodes: Array<{ id: string; title: string; status: string; priority?: string }>;
    edges: Array<{ from: string; to: string; type: 'blocks' | 'blockedBy' | 'related' }>;
  };
  summarization: {
    stage: 'starting' | 'in_progress' | 'complete' | 'failed';
    messageCount: number;
    keepingCount: number;
    saved?: number;
    error?: string;
  };
  tool_progress: {
    toolName: string;
    stage?: 'starting' | 'in_progress' | 'complete' | 'failed';
    progress?: number;
  };
  error: {
    error: string;
    toolName?: string;
    context?: string;
    recoverable?: boolean;
  };
  memory_update: {
    type: 'lesson' | 'fact' | 'pattern';
    action: 'saved' | 'updated' | 'deleted';
    count?: number;
  };
  swarm_signal: {
    from: string;
    to?: string;
    signal: string;
    data?: Record<string, unknown>;
  };
  delegation: {
    agentName: string;
    task: string;
    status: 'starting' | 'in_progress' | 'complete' | 'failed';
    result?: unknown;
  };
}
```

## Best Practices

1. **Use `onData` for transient updates**: Notifications and ephemeral status should be handled in `onData` since they won't persist in message history.

2. **Render persistent parts from `message.parts`**: Task updates, errors, and other important data should be rendered from the message parts array.

3. **Track agent state separately**: Use local state to track reasoning mode, tasks, and memory stats. Update them via `onData` as data streams in.

4. **Type filtering**: Use TypeScript's type guards to filter parts by type for type-safe rendering.

5. **Reconciliation**: Data parts with the same `id` are automatically reconciled, so you can show loading states that transform into results.
