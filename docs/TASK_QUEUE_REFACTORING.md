# Task Queue Refactoring Proposal

## Executive Summary

The codebase currently has **two separate task systems** operating at different layers without proper integration. This document proposes a refactoring to unify task management through the TasksPlugin while maintaining the SessionProcessor's role in session-level concurrency control.

## Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Extend TasksPlugin | ✅ Complete | TaskType enum, event system, type filtering added |
| Phase 1: Refactor ReflexionPlugin | ✅ Complete | Uses TasksPlugin for error analysis tasks |
| Phase 2: PlanningPlugin integration | ✅ Complete | Sets correct TaskType for generated tasks |
| Phase 3: Agent wiring | ✅ Complete | setupPluginDependencies() added to VibeAgent |
| Phase 4: Testing | ⚠️ Pending | No unit tests exist yet |

---

---

## Current State Analysis

### Layer 1: Session-Level Task Execution (`SessionProcessor`)

**Location:** `packages/harness-vibes/src/processor/`

**Purpose:** Manage concurrent execution across multiple sessions

**Features:**
- Priority queue with dependency management
- Per-session and global concurrency limits
- Retry logic with exponential backoff
- Timeout handling
- Multiple task types: `message`, `tool`, `background`, `cleanup`, `delegation`

**Current Task Model:**
```typescript
interface QueuedTask {
    id: string;
    sessionId: string;
    type: TaskType;
    priority: SessionPriority;
    status: TaskStatus;
    payload: unknown;
    createdAt: number;
    retryCount: number;
    maxRetries: number;
    timeout: number;
    dependencies?: string[];
}
```

### Layer 2: Agent-Level Task Planning (`TasksPlugin` / `PlanningPlugin`)

**Location:** `packages/harness-vibes/src/plugins/`

**Purpose:** Help the agent plan and track its work

**Features:**
- Plan generation from user requests
- Task decomposition
- Task recitation in system prompts
- Simple file persistence to `workspace/tasks.json`
- Basic dependency filtering

**Current Task Model:**
```typescript
interface TaskItem {
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    priority: 'low' | 'medium' | 'high' | 'critical';
    blockedBy: string[];
    blocks: string[];
    fileReferences: string[];
    metadata: {
        planId?: string;
        planPhase?: string;
        planReference?: string;
    };
}
```

### The Problem

| Issue | Impact |
|-------|--------|
| **ReflexionPlugin's ad-hoc queuing** | Uses `pendingAnalyses` Set instead of proper task system |
| **Dual task models** | `QueuedTask` and `TaskItem` can't be unified |
| **No integration** | Agent tasks aren't visible to session processor |
| **Scattered queue logic** | Different plugins implement their own "queue for later" patterns |

---

## Proposed Architecture

### Core Principle: **Separation of Concerns**

```
┌──────────────────────────────────────────────────────────────────┐
│                     Application Layer                            │
│  (HTTP requests, WebSocket connections, CLI commands)            │
└─────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    SessionProcessor Layer                        │
│  • Manages concurrent execution across sessions                  │
│  • Priority queue for: message execution, background jobs        │
│  • Per-session rate limiting and resource control                │
│  • Does NOT manage agent's internal task planning                │
└─────────────────────────────┬────────────────────────────────────┘
                              │
                              │ delegates to
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                        DeepAgent                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                   Plugin System                            │ │
│  │                                                             │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │              PlanningPlugin                          │ │ │
│  │  │  • Generates high-level plans from requests          │ │ │
│  │  │  • Decomposes plans into actionable tasks            │ │ │
│  │  │  • Provides task recitation for attention management │ │ │
│  │  │  • Uses TasksPlugin for storage                      │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                           │                                 │ │
│  │                           ▼                                 │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │              TasksPlugin                             │ │ │
│  │  │  • Central task registry for the agent               │ │ │
│  │  │  • Handles ALL agent-level tasks:                    │ │ │
│  │  │    - User-request tasks (from PlanningPlugin)        │ │ │
│  │  │    - Error analysis tasks (from ReflexionPlugin)     │ │ │
│  │  │    - Background analysis tasks                       │ │ │
│  │  │  • Provides task lifecycle management                │ │ │
│  │  │  • Emits events for task completion                  │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                                                             │ │
│  │  Other plugins consume tasks from TasksPlugin:             │ │
│  │  • ReflexionPlugin - creates error analysis tasks         │ │
│  │  • ReasoningPlugin - may create sub-tasks                 │ │
│  │  • SubAgentPlugin - creates delegation tasks              │ │
│  │                                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Key Responsibilities

| Component | Responsibilities | NOT Responsible For |
|-----------|------------------|---------------------|
| **SessionProcessor** | • Session-level concurrency<br>• Message execution queueing<br>• Background job scheduling<br>• Resource limits | • Agent's internal task planning<br>• Breaking down user requests |
| **TasksPlugin** | • Agent's TODO list<br>• Task lifecycle management<br>• Task dependencies<br>• Task persistence | • Session concurrency control<br>• Message execution scheduling |
| **PlanningPlugin** | • High-level plan generation<br>• Task decomposition from plans | • Task execution scheduling |
| **ReflexionPlugin** | • Error detection<br>• Creating analysis tasks via TasksPlugin | ❌ Managing its own task queue |

---

## Implementation Plan

### Phase 1: Unify ReflexionPlugin (Quick Win)

**Problem:** ReflexionPlugin uses `pendingAnalyses` Set for deferred error analysis.

**Solution:** Use TasksPlugin for error analysis tasks.

#### Before (ReflexionPlugin):
```typescript
private pendingAnalyses: Set<string> = new Set();

onError(error: Error) {
    const errorKey = this.getErrorKey(error);
    if (!this.pendingAnalyses.has(errorKey)) {
        this.pendingAnalyses.add(errorKey);
        // Queue for later
    }
}

private async checkPendingAnalyses() {
    for (const errorKey of this.pendingAnalyses) {
        // Analyze error
    }
}
```

#### After:
```typescript
constructor(private tasksPlugin: TasksPlugin) {}

modifySystemPrompt(prompt: string): string {
    return `${prompt}

## Error Analysis
When errors recur, use the TasksPlugin to create and track error analysis tasks.
Available tools:
- create_task(title="Analyze error: X", description="...", type="error_analysis", priority="high")
`;
}

onError(error: Error) {
    const errorKey = this.getErrorKey(error);

    // Check if we already have an analysis task for this error
    const existingTask = this.tasksPlugin.getTasks().find(t =>
        t.metadata?.errorKey === errorKey && t.status !== 'completed'
    );

    if (!existingTask) {
        // Create a task for error analysis
        this.tasksPlugin.addTask({
            id: `error_analysis_${Date.now()}`,
            title: `Analyze recurring error: ${error.message.slice(0, 50)}`,
            description: `Error has occurred multiple times. Analyze root cause and generate lessons.`,
            status: 'pending',
            priority: 'high',
            type: 'error_analysis',
            metadata: { errorKey, error: error.message },
            blockedBy: [],  // Not blocked by anything
        });
    }
}
```

**Benefits:**
- Error analysis tasks visible in task recitation
- Proper task lifecycle management
- Can be prioritized alongside other tasks
- Persistent across restarts

---

### Phase 2: Extend TasksPlugin with Task Types

Add proper task type support to TasksPlugin:

```typescript
// Add to types.ts
export enum TaskType {
    UserRequest = 'user_request',      // From PlanningPlugin
    SubTask = 'subtask',                // Created by agent
    ErrorAnalysis = 'error_analysis',   // From ReflexionPlugin
    Delegation = 'delegation',          // From SubAgentPlugin
    Background = 'background',          // Async background work
}

export interface TaskItem {
    // ... existing fields ...
    type: TaskType;
    metadata: {
        // ... existing fields ...
        errorKey?: string;               // For error analysis
        agentName?: string;              // For delegations
    };
}
```

Update TasksPlugin to support task types:

```typescript
// Add filtering by type
async getTasksByType(type: TaskType): Promise<TaskItem[]> {
    return this.tasks.filter(t => t.type === type);
}

// Add type-based priority
getTypePriority(type: TaskType): number {
    const priorities = {
        [TaskType.ErrorAnalysis]: 100,
        [TaskType.UserRequest]: 50,
        [TaskType.Delegation]: 40,
        [TaskType.SubTask]: 20,
        [TaskType.Background]: 10,
    };
    return priorities[type] || 0;
}
```

---

### Phase 3: Add Task Events to TasksPlugin

Enable other components to react to task completion:

```typescript
// Add to TasksPlugin
type TaskEventListener = (task: TaskItem) => void | Promise<void>;

private listeners: Map<string, TaskEventListener[]> = new Map();

on(event: 'created' | 'updated' | 'completed', callback: TaskEventListener): void {
    if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
}

private async emit(event: string, task: TaskItem): Promise<void> {
    const callbacks = this.listeners.get(event) || [];
    for (const callback of callbacks) {
        try {
            await callback(task);
        } catch (e) {
            console.error(`Task event listener error (${event}):`, e);
        }
    }
}

// Update updateTask to emit events
async updateTask(id: string, updates: Partial<TaskItem>): Promise<void> {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index === -1) return;

    const oldTask = this.tasks[index];
    this.tasks[index] = { ...oldTask, ...updates, updatedAt: new Date().toISOString() };

    // Emit events
    if (updates.status && updates.status !== oldTask.status) {
        if (updates.status === 'completed') {
            this.emit('completed', this.tasks[index]);
        }
        this.emit('updated', this.tasks[index]);
    }
}
```

---

### Phase 4: Integration Layer (Optional)

For visibility into agent tasks at the session level, add a bridge:

```typescript
// packages/harness-vibes/src/core/task-bridge.ts

/**
 * Bridges TasksPlugin with SessionProcessor for visibility
 */
export class TaskBridge {
    constructor(
        private tasksPlugin: TasksPlugin,
        private processor: SessionProcessor
    ) {}

    /**
     * Sync agent tasks to session-level visibility
     */
    syncTasks(sessionId: string): void {
        const tasks = this.tasksPlugin.getTasks();

        // Could emit session events with task summaries
        // Or create lightweight "task status" tasks in processor
    }

    /**
     * Listen for task completion and notify processor
     */
    setupListeners(): void {
        this.tasksPlugin.on('completed', (task) => {
            // Notify processor that agent made progress
            // Could be used for metrics, lifecycle management
        });
    }
}
```

---

## Migration Strategy

### Step 1: Prepare TasksPlugin (1-2 hours)
1. Add `TaskType` enum
2. Extend `TaskItem` interface with `type` field
3. Add `getTasksByType()` method
4. Add event system (`on`, `emit`)

### Step 2: Refactor ReflexionPlugin (1 hour)
1. Remove `pendingAnalyses` Set
2. Inject TasksPlugin
3. Create error analysis tasks via TasksPlugin
4. Update system prompt instructions

### Step 3: Update PlanningPlugin (30 min)
1. Set `type: TaskType.UserRequest` for generated tasks
2. Set `type: TaskType.SubTask` for subtasks

### Step 4: Update SubAgentPlugin (30 min)
1. Set `type: TaskType.Delegation` for delegated tasks
2. Track agent name in metadata

### Step 5: Testing (1-2 hours)
1. Test error analysis task creation
2. Test task recitation with new types
3. Test task completion events
4. Verify persistence across restarts

---

## Benefits

| Area | Before | After |
|------|--------|-------|
| **ReflexionPlugin** | Ad-hoc Set for queued analyses | Proper task tracking with TasksPlugin |
| **Task Visibility** | Tasks scattered across plugins | Centralized in TasksPlugin |
| **Task Types** | No distinction between task types | Clear categorization |
| **Events** | No notification system | Plugins can react to task completion |
| **Persistence** | Some tasks lost on restart | All tasks persisted to disk |
| **Recitation** | Only user request tasks shown | All task types in recitation |

---

## Trade-offs & Considerations

### Concern: "Won't this make TasksPlugin too complex?"

**Response:** No. TasksPlugin already handles the core task lifecycle. Adding:
- Task types (enum field)
- Event listeners (simple observer pattern)
- Type filtering (array filter)

These are natural extensions that don't complicate the core logic.

### Concern: "Should SessionProcessor manage TasksPlugin tasks?"

**Response:** No. They operate at different layers:

- **SessionProcessor** = "Which session's message should I execute now?"
- **TasksPlugin** = "What tasks does the agent need to complete?"

The processor doesn't need to know about the agent's internal tasks. However, we could add optional integration (TaskBridge) for metrics/visibility.

### Concern: "Performance impact of events?"

**Response:** Minimal. Events are:
- Only emitted on status changes
- Handled asynchronously
- Can be optionally subscribed to

---

## Success Criteria

- [ ] ReflexionPlugin uses TasksPlugin for error analysis
- [ ] All tasks have a `type` field
- [ ] Task recitation shows all task types
- [ ] Task completion events work correctly
- [ ] No performance degradation
- [ ] All tasks persist across restarts
- [ ] Tests pass for modified plugins

---

## Future Enhancements

1. **Task Dependencies Graph** - Visual representation of task dependencies
2. **Task History** - Track completed tasks for analytics
3. **Task Templates** - Reusable task patterns
4. **Task Metrics** - Track completion rates, times per type
5. **Priority Inheritance** - Subtasks inherit parent priority
6. **Parallel Task Execution** - Agent works on multiple independent tasks

---

## Conclusion

This refactoring unifies task management through TasksPlugin while maintaining clear separation of concerns:

- **SessionProcessor** handles session-level concurrency
- **TasksPlugin** handles agent-level task planning
- **All plugins** use TasksPlugin for their task needs

The result is a cleaner, more maintainable architecture with proper task visibility and lifecycle management.
