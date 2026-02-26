# Deep Agent Architecture Discussion

## Context

This document captures the design discussion for enhancing the Vibes agent framework with deep agent capabilities based on research from Manus, LangChain's Deep Agents, and agentic reasoning patterns.

---

## Current Architecture Assessment

### What We Have ✓

| Component | Status | Implementation |
|-----------|--------|----------------|
| **Core Agent** | ✓ | VibeAgent extends ToolLoopAgent with middleware support |
| **Tasks** | ✓ | TasksMiddleware with dependencies (`blockedBy`/`blocks`) |
| **Sub-Agents** | ✓ | SubAgentMiddleware with delegation caching |
| **Memory** | ✓ | MemoryMiddleware (scratchpad + reflections) |
| **File System** | ✓ | FilesystemMiddleware for workspace access |
| **Sessions** | ✓ | SessionManager for multi-instance support |
| **Context Summarization** | ✓ | Message summarization when exceeding limits |

### Key Insight

We have solid foundational pieces. The gap is in how they're **orchestrated** to create "deep agent" behavior - specifically around **attention management** and **context engineering**.

---

## Design Discussion: Tasks vs Planning

### Question: Should we create a new PlanningMiddleware or enhance TasksMiddleware?

**Current TasksMiddleware capabilities:**
- `generate_tasks()` - AI breaks down work
- `create_tasks()` - Manual task creation
- `update_task()` - Mark in_progress/completed
- `get_next_tasks()` - Get available tasks (unblocked)
- `list_tasks()` - See all tasks
- Dependencies via `blockedBy`/`blocks`

**What "deep agent" planning adds:**

| Feature | Purpose | Why it matters |
|---------|---------|----------------|
| **Task Recitation** | Push plan into recent attention | Prevents "lost-in-the-middle" in long contexts |
| **Plan Persistence** | Save/load plan files | Continuity across sessions |
| **Active Plan Updating** | Agent rewrites its plan | Manipulates attention via recitation (Manus key insight) |

### Recommendation: Enhance TasksMiddleware

Create a `PlanningMiddleware` that **extends** `TasksMiddleware`. This preserves existing functionality while adding deep agent features.

---

## Design Discussion: Summarization vs Compression

### Key Distinction

| Aspect | Summarization (Current) | Restorable Compression (Manus) |
|--------|------------------------|-------------------------------|
| **What it does** | Converts old messages to narrative | Replaces large content with references |
| **Information loss** | Lossy - details gone | Minimal - content still accessible |
| **Reversibility** | No - cannot get original back | Yes - can re-fetch/read |
| **Best for** | Conversation history | Large file reads, web content, tool outputs |

### Example Comparison

**Scenario: Agent read a 500-line auth.ts file**

Summarization approach:
```
## Previous Context Summary
The user asked about authentication. I read src/auth.ts which contains
login logic including password validation and session management...
```

Restorable compression approach:
```
[File: src/auth.ts - 500 lines read, full content available in workspace]
```

If agent needs the actual code later, it can `readFile('src/auth.ts')` again.

### What Should NEVER Be Compressed

Based on Manus research:
- **Errors** - Keep full stack traces for self-correction
- **User messages** - Never modify what the user said
- **Plan/task state** - Critical for maintaining context

### Recommendation: Hybrid Approach

1. **First pass:** Restorable compression for large content
2. **Second pass:** Summarization if still over limit
3. **Never compress:** Errors, user messages, task state

---

## Design Discussion: Task Recitation Strategy

### The Manus Insight

From Manus blog: *"By constantly rewriting the todo list, Manus is reciting its objectives into the end of the context. This pushes the global plan into the model's recent attention span."*

This is **attention manipulation** - a technique to keep the agent focused on long-horizon goals.

### Recitation Options

| Option | Mechanism | Pros | Cons |
|--------|-----------|------|------|
| **Automatic** | Every N steps, inject plan | Always on, no agent effort | May be wasteful if plan unchanged |
| **Tool-triggered** | Agent calls `recite_plan()` | Agent-controlled | Agent may forget to do it |
| **Smart automatic** | Inject when plan changes OR every N steps | Best of both | Slightly more complex |

### Recommendation: Smart Automatic

- Inject plan into system prompt on every `prepareCall`
- Only regenerate when plan actually changes
- This ensures the plan is **always in recent attention**

---

## Design Discussion: Error Handling

### Current Behavior

Errors are included in the message stream and may get folded into summaries.

### Manus Approach

*"One of the most effective ways to improve agent behavior is deceptively simple: leave the wrong turns in the context... We believe error recovery is one of the clearest indicators of true agentic behavior."*

### Recommendation: Error Preservation

1. **Never include errors in summarization**
2. **Maintain a "Recent Errors" section** in system prompt
3. **Auto-extract lessons** from repeated errors

---

## Final Architecture Decisions

### Decision 1: Planning

**Create `PlanningMiddleware` that extends `TasksMiddleware`**

```typescript
export class PlanningMiddleware extends TasksMiddleware {
    // Adds:
    // - Auto-recitation in modifySystemPrompt
    // - Plan save/load tools
    // - Hierarchical task support
}
```

### Decision 2: Context Compression

**Add restorable compression phase before summarization**

```typescript
protected async pruneMessages(messages: ModelMessage[]): Promise<ModelMessage[]> {
    // Phase 1: Restorable compression (lossless references)
    const compressed = await this.compressLargeContent(messages);

    // Phase 2: Summarization (lossy, only if needed)
    if (compressed.length > this.maxContextMessages) {
        return await this.summarizeOldMessages(compressed);
    }
    return compressed;
}
```

### Decision 3: Task Recitation

**Always include current plan in system prompt**

```typescript
modifySystemPrompt(prompt: string): string {
    const basePrompt = super.modifySystemPrompt(prompt);
    const pendingTasks = this.getPendingTasks();
    if (pendingTasks.length > 0) {
        return basePrompt + this.formatPlanForRecitation(pendingTasks);
    }
    return basePrompt;
}
```

### Decision 4: Error Handling

**Separate errors from summarization stream**

```typescript
// Track errors separately
private errorLog: ErrorEntry[] = [];

// Never fold errors into summary
protected extractErrorsForSummary(messages: ModelMessage[]): {
    messagesWithoutErrors: ModelMessage[];
    errors: ErrorEntry[];
}

// Always show recent errors in prompt
modifySystemPrompt(prompt: string): string {
    // ... existing logic
    if (this.errorLog.length > 0) {
        prompt += this.formatRecentErrors();
    }
    return prompt;
}
```

---

## Implementation Priority

| Priority | Feature | Impact | Effort | File |
|----------|---------|--------|--------|------|
| P0 | Task recitation in system prompt | High | Low | `PlanningMiddleware` |
| P0 | Error preservation | High | Low | `agent.ts` |
| P1 | Restorable compression | High | Medium | `agent.ts` |
| P2 | Plan save/load tools | Medium | Low | `PlanningMiddleware` |
| P2 | Hierarchical tasks | Medium | Medium | `PlanningMiddleware` |
| P3 | Auto-lesson extraction | Low | High | New `ErrorLearningMiddleware` |

---

## Files to Create/Modify

### New Files
- `src/the-vibes/middleware/planning.ts` - Extends TasksMiddleware with recitation

### Modified Files
- `src/the-vibes/core/agent.ts` - Add restorable compression, error tracking
- `src/the-vibes/core/types.ts` - Add error-related types
- `src/the-vibes/index.ts` - Export PlanningMiddleware, use in DeepAgent

### Deprecate
- `src/the-vibes/middleware/todos.ts` - Use PlanningMiddleware instead

---

## Implementation Summary

### Completed ✅

#### 1. PlanningMiddleware (`src/the-vibes/middleware/planning.ts`)
- **Task Recitation**: Auto-refreshes task cache before each model call
- **Plan Persistence**: `save_plan()` and `load_plan()` tools for filesystem backup
- **Hierarchical Tasks**: `create_subtask()` for parent-child relationships
- **Composed Pattern**: Implements Middleware directly, composes TasksMiddleware internally

**Key Features:**
```typescript
// Tools added:
- save_plan(path) - Save current tasks to markdown file
- load_plan(path, clearExisting) - Load plan from file
- recite_plan() - Manual trigger to refresh and view plan
- create_subtask(parentTaskId, title, ...) - Create blocked subtask

// Automatic behavior:
- Refreshes task cache before each model call (beforeModel hook)
- Formats tasks with emoji icons for visual hierarchy
- Shows: 🔵 Working Now → 📋 Next Up → ⏸️ Blocked
```

#### 2. Restorable Compression (`src/the-vibes/core/agent.ts`)
**Methods added:**
- `compressLargeContent(messages)` - Phase 1 compression before summarization
- `compressMessage(msg, content)` - Per-message compression logic
- `extractToolInfo(msg)` - Extract tool name and args from messages
- `extractErrorMessages(messages)` - Separate errors before summarization

**Compression Strategy:**
| Content Type | Compression Method |
|--------------|-------------------|
| `readFile` result | `[File: path - N chars read. Use readFile() again if needed.]` |
| `bash` result | `[Command "cmd..." output: N chars. Run again if needed.]` |
| Generic tool output | Summary + "run again if full details needed" |
| Errors | **NEVER compress** - tracked separately |

#### 3. Error Preservation (`src/the-vibes/core/agent.ts`)
**Added:**
- `errorLog: ErrorEntry[]` - Separate error tracking
- `logError(toolName, error, context)` - Add error with deduplication
- `getRecentErrors()` - Get recent errors sorted by frequency
- `formatRecentErrors(errors)` - Format for system prompt display
- Errors added to prompt via `prepareCall`

**In System Prompt:**
```markdown
## Recent Errors (Do NOT Repeat These)

The following errors occurred recently. Learn from them and avoid making the same mistakes.

### readFile ×3
```
Error message...
```

---

### Remaining Tasks 📋

**To implement:**
- Tree-of-Thoughts reasoning middleware
- Semantic memory with vector store
- Enhanced reflexion (error → lesson extraction)
- Parallel sub-agent delegation
- Swarm collaboration patterns

---

## References

- [Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- [Deep Agents - LangChain Blog](https://www.blog.langchain.com/deep-agents/)
- [The Four Pillars of Deep Agents](https://prajnaaiwisdom.medium.com/the-four-pillars-of-deep-agents-planning-delegation-memory-context-59e40376dbc5)
