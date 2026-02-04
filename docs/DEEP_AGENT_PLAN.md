# Deep Agent Enhancement Plan

Based on research from Manus, LangChain's Deep Agents, and agentic reasoning patterns, this plan outlines enhancements to transform the Vibes agent into a true "deep agent."

---

## Current State Analysis

### What We Have ✓
| Component | Status | Notes |
|-----------|--------|-------|
| **Core Agent** | ✓ | VibeAgent extends ToolLoopAgent with middleware support |
| **Sub-Agents** | ✓ | SubAgentMiddleware with delegation caching |
| **Tasks** | ✓ | TasksMiddleware with dependencies and templates |
| **Memory** | Partial | MemoryMiddleware has scratchpad + reflections |
| **File System** | ✓ | FilesystemMiddleware for workspace access |
| **Sessions** | ✓ | SessionManager for multi-instance support |
| **Context Pruning** | ✓ | Message summarization when exceeding limits |

### What's Missing ✗
| Deep Agent Feature | Gap |
|-------------------|-----|
| **KV-Cache Optimization** | No cache-aware context design |
| **Todo Recitation** | No attention manipulation via plan repetition |
| **Tree-of-Thoughts** | No parallel reasoning path exploration |
| **Semantic Memory** | No vector-based fact retrieval |
| **Plan-and-Execute** | No separate planning phase |
| **Error Recovery** | Errors kept but not systematically learned from |
| **Tool Masking** | Dynamic tool loading not cache-friendly |

---

## Implementation Plan

### Phase 1: KV-Cache Optimization (High Impact, Low Effort)

**Goal:** Minimize token costs and latency through cache-aware design.

#### 1.1 Cache-Aware System Prompt
**File:** `src/the-vibes/core/agent.ts`

```typescript
// Add to VibeAgent
protected cacheBreakpointMarker = '---CACHE_BREAKPOINT---';

protected async buildCacheOptimizedPrompt(): Promise<string> {
    // Keep prefix stable - no timestamps in system prompt
    // Place cache breakpoint after system instructions
    // Append dynamic context after breakpoint
}
```

**Key Changes:**
- Remove any timestamps from system prompt generation
- Add explicit cache breakpoint markers for providers that support it
- Make context append-only (never modify existing messages)

#### 1.2 Stable Tool Definitions
**File:** `src/the-vibes/core/agent.ts`

```typescript
// Keep tool definitions at head of context, never modify mid-session
// Use logit masking instead of adding/removing tools
protected toolMaskingMode: 'auto' | 'required' | 'specified' = 'auto';
```

#### 1.3 Session-Based Routing
**File:** `src/the-vibes/backend/statebackend.ts`

```typescript
// Add session affinity for distributed caching
export class CacheAwareBackend extends StateBackend {
    sessionId: string;
    cacheKey: string; // Stable key for this session's context prefix
}
```

---

### Phase 2: Planning & Attention Manipulation (High Impact)

**Goal:** Enable long-horizon reasoning through explicit planning and attention control.

#### 2.1 Todo Recitation (Manus-style)
**File:** `src/the-vibes/middleware/planning.ts` (NEW)

```typescript
/**
 * PlanningMiddleware provides:
 * - Todo list creation and maintenance
 * - Automatic recitation to manipulate attention
 * - Hierarchical task decomposition
 */
export class PlanningMiddleware implements Middleware {
    name = 'PlanningMiddleware';

    // Tools
    - create_plan(request: string): Creates hierarchical todo list
    - update_plan(plan: PlanTree): Updates plan with current status
    - recite_plan(): Injects plan at end of context for attention

    // Key feature: Automatic recitation every N steps
    // This pushes global plan into recent attention span
    // Prevents "lost-in-the-middle" issues in long contexts
}
```

**How it works:**
1. Agent creates a plan via `create_plan()`
2. Plan is saved to `workspace/plan.md`
3. Every 10 steps, plan is automatically re-injected into context
4. Agent updates plan items as they complete

#### 2.2 Tree-of-Thoughts Reasoning
**File:** `src/the-vibes/middleware/reasoning.ts` (NEW)

```typescript
/**
 * ReasoningMiddleware provides multiple reasoning patterns:
 * - ReAct: Think-act loop (default)
 * - ToT: Tree of Thoughts for parallel exploration
 * - Plan-Execute: Separate planning and execution phases
 */
export class ReasoningMiddleware implements Middleware {
    mode: 'react' | 'tot' | 'plan-execute';

    // For ToT mode
    - generate_thoughts(prompt: string, count: number): Creates multiple reasoning branches
    - evaluate_thoughts(thoughts: string[]): Scores each branch
    - select_best(thoughts: string[], scores: number[]): Chooses path
}
```

#### 2.3 Enhanced Task Templates
**File:** `src/the-vibes/backend/statebackend.ts`

```typescript
// Add new templates
const deepResearchTemplate: TaskTemplate = {
    id: 'deep_research',
    name: 'Deep Research',
    subTasks: [
        { title: 'Gather sources' },
        { title: 'Extract key insights' },
        { title: 'Synthesize findings' },
        { title: 'Create deliverable' }
    ]
};

const codeEvolutionTemplate: TaskTemplate = {
    id: 'code_evolution',
    name: 'Code Evolution',
    subTasks: [
        { title: 'Analyze existing code' },
        { title: 'Identify improvement paths' },
        { title: 'Plan refactoring' },
        { title: 'Implement changes' },
        { title: 'Verify behavior' }
    ]
};
```

---

### Phase 3: Enhanced Memory System (Medium Impact, Medium Effort)

**Goal:** Implement hierarchical memory with semantic retrieval.

#### 3.1 Semantic Memory Layer
**File:** `src/the-vibes/middleware/semantic-memory.ts` (NEW)

```typescript
/**
 * SemanticMemoryMiddleware provides vector-based fact storage:
 * - Stores important facts as embeddings
 * - Retrieves relevant facts for current context
 * - Maintains episodic logs of interactions
 */
export class SemanticMemoryMiddleware implements Middleware {
    private vectorStore: SimpleVectorStore; // In-memory for now

    // Tools
    - remember_fact(fact: string, importance: number): Store important fact
    - recall_facts(query: string, limit: number): Retrieve relevant facts
    - forget_fact(id: string): Remove a fact

    // Automatic: Important observations are automatically stored
    onStepFinish(step) {
        // Extract facts from tool results
        // Store with timestamp and importance score
    }
}
```

**Implementation options:**
1. **Simple:** Use text embeddings with cosine similarity (Bun-native)
2. **Full:** Integrate with vector DB (Pinecone, Weaviate)

#### 3.2 Procedural Memory
**File:** `src/the-vibes/middleware/procedural-memory.ts` (NEW)

```typescript
/**
 * ProceduralMemoryMiddleware stores patterns and workflows:
 * - Successful approaches to problems
 * - Common code patterns used
 * - Project-specific conventions
 */
export class ProceduralMemoryMiddleware implements Middleware {
    private patterns: Map<string, Pattern>;

    // Tools
    - save_pattern(name: string, pattern: string): Store a reusable pattern
    - get_patterns(context: string): Get relevant patterns
    - apply_pattern(name: string, params: any): Apply a pattern
}
```

#### 3.3 Enhanced Reflexion
**File:** `src/the-vibes/middleware/memory.ts` (ENHANCE)

```typescript
// Add to existing MemoryMiddleware

// Tools
- analyze_errors(): Review recent errors and extract lessons
- get_reflections(topic?: string): Retrieve relevant reflections
- update_strategy(): Update approach based on learnings

// Automatic: After each error, prompt for reflection
onToolError(error) {
    // Queue reflection prompt for next turn
}
```

---

### Phase 4: Context Engineering (High Impact)

**Goal:** Implement Manus-style context management techniques.

#### 4.1 Restorable Compression
**File:** `src/the-vibes/core/agent.ts`

```typescript
/**
 * Instead of dropping context, compress to restorable form:
 * - Long web page → URL reference (can re-fetch)
 * - File contents → File path reference
 * - Tool results → Summary + original data path
 */
protected async compressContext(messages: ModelMessage[]): Promise<ModelMessage[]> {
    const compressed: ModelMessage[] = [];

    for (const msg of messages) {
        const processed = await this.compressMessage(msg);
        compressed.push(processed);
    }

    return compressed;
}

private async compressMessage(msg: ModelMessage): Promise<ModelMessage> {
    // Large tool results → reference
    // File reads → path reference
    // Web content → URL reference
    // Keep user messages and summaries
}
```

#### 4.2 Error Retention
**File:** `src/the-vibes/middleware/error-tracking.ts` (NEW)

```typescript
/**
 * ErrorTrackingMiddleware ensures errors are kept in context:
 * - Failed tool calls are NEVER removed
 * - Stack traces are preserved
 * - Model learns from failures
 */
export class ErrorTrackingMiddleware implements Middleware {
    private errorLog: ErrorEntry[] = [];

    // Never compress error messages
    // Always include recent errors in context
    modifySystemPrompt(prompt: string): string {
        if (this.errorLog.length === 0) return prompt;

        const errorSection = '\n\n## Recent Errors (Do NOT repeat these)\n';
        // Add last 5 errors with context
        return prompt + errorSection;
    }
}
```

#### 4.3 Variance Injection
**File:** `src/the-vibes/core/agent.ts`

```typescript
/**
 * Introduce controlled variance to prevent few-shot overfitting:
 * - Alternate serialization templates
 * - Varied phrasing in system prompt
 * - Controlled noise in ordering
 */
protected addVarianceToContext(messages: ModelMessage[]): ModelMessage[] {
    // Every N turns, slightly vary message format
    // This prevents model from mimicking patterns too rigidly
}
```

---

### Phase 5: Enhanced Delegation (Medium Impact)

**Goal:** Improve sub-agent coordination and parallel execution.

#### 5.1 Parallel Delegation
**File:** `src/the-vibes/middleware/subagent.ts` (ENHANCE)

```typescript
/**
 * Add parallel task execution:
 * - Multiple sub-agents can work simultaneously
 * - Results are collected and merged
 */
export class SubAgentMiddleware implements Middleware {
    // New tool
    parallel_delegate: tool({
        description: 'Delegate multiple tasks to sub-agents in parallel',
        inputSchema: z.object({
            tasks: z.array(z.object({
                agent_name: z.string(),
                task: z.string()
            }))
        }),
        execute: async ({ tasks }) => {
            // Execute all tasks concurrently
            const results = await Promise.all(
                tasks.map(t => this.delegateToAgent(t.agent_name, t.task))
            );
            return { results };
        }
    });
}
```

#### 5.2 Swarm Collaboration
**File:** `src/the-vibes/middleware/swarm.ts` (NEW)

```typescript
/**
 * SwarmMiddleware enables decentralized agent collaboration:
 * - Agents share state via shared memory
 * - Agents can signal each other
 * - No central coordinator needed
 */
export class SwarmMiddleware implements Middleware {
    private sharedState: Map<string, any>;

    // Tools
    - signal(agent: string, message: string): Send signal to another agent
    - read_shared_state(key: string): Read shared value
    - write_shared_state(key: string, value: any): Write shared value
}
```

---

## Priority Matrix

| Phase | Impact | Effort | Priority | Dependencies |
|-------|--------|--------|----------|--------------|
| Phase 1: KV-Cache | High | Low | **P0** | None |
| Phase 2.1: Todo Recitation | High | Medium | **P0** | None |
| Phase 4.2: Error Retention | High | Low | **P0** | None |
| Phase 2.2: Tree-of-Thoughts | Medium | Medium | P1 | Phase 2.1 |
| Phase 4.1: Restorable Compression | High | Medium | P1 | Phase 1 |
| Phase 3.1: Semantic Memory | Medium | High | P2 | None |
| Phase 5.1: Parallel Delegation | Medium | Medium | P2 | None |
| Phase 3.3: Enhanced Reflexion | Medium | Low | P2 | Phase 3.1 |
| Phase 2.3: Task Templates | Low | Low | P3 | None |
| Phase 5.2: Swarm Collaboration | Low | High | P3 | Phase 5.1 |

---

## Implementation Order

### Sprint 1: Quick Wins (1-2 days) ✅ COMPLETED
1. ✅ Cache-aware system prompt (Phase 1) - Done (agent.ts)
2. ✅ Error retention enhancement (Phase 4.2) - Done (agent.ts)
3. ✅ Remove timestamps from context (Phase 1) - Done (agent.ts)

### Sprint 2: Core Deep Agent Features (3-5 days) 🔄 IN PROGRESS
4. ✅ PlanningMiddleware with todo recitation (Phase 2.1) - Done (planning.ts)
5. ✅ Restorable compression (Phase 4.1) - Done (agent.ts)
6. ✅ Enhanced task templates (Phase 2.3) - Existing (statebackend.ts)

### Sprint 3: Advanced Reasoning (5-7 days) ✅ COMPLETED
7. ✅ Tree-of-Thoughts reasoning (Phase 2.2) - Done (reasoning.ts)
8. ✅ Semantic memory layer (Phase 3.1) - Done (semantic-memory.ts)
9. ✅ Enhanced reflexion (Phase 3.3) - Done (reflexion.ts)

### Sprint 4: Collaboration (3-5 days) ✅ COMPLETED
10. ✅ Parallel delegation (Phase 5.1) - Done (subagent.ts)
11. ✅ Procedural memory (Phase 3.2) - Done (procedural-memory.ts)
12. ✅ Swarm collaboration (Phase 5.2) - Done (swarm.ts)

---

## Key Principles from Research

### From Manus
1. **Design around KV-cache** - Stable prefix, append-only context
2. **Mask, don't remove** - Use logit masking, not dynamic tool loading
3. **File system as context** - Unlimited external memory
4. **Recite for attention** - Push goals into recent attention span
5. **Keep errors visible** - Enable self-correction
6. **Avoid few-shot rigidity** - Introduce variance

### From LangChain Deep Agents
1. **Detailed system prompt** - Long, nuanced instructions
2. **Planning tool** - Even if no-op, keeps agent on track
3. **Sub-agents** - Split complex tasks
4. **File system** - Shared workspace for collaboration

### From Agentic Reasoning Patterns
1. **PRAR Loop** - Perception → Reasoning → Action → Reflection
2. **ReAct** - Think-act for dynamic environments
3. **Reflexion** - Self-improvement via reflection
4. **Plan-and-Execute** - Separate planning from action
5. **Tree-of-Thoughts** - Parallel exploration

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Cache hit rate | Unknown | >80% | Monitor KV-cache utilization |
| Token efficiency | Baseline | 2x improvement | Tokens per task completion |
| Error recovery rate | Unknown | >60% | Tasks succeeding after error |
| Long-horizon success | Unknown | >70% | Tasks with >20 steps |
| Sub-agent utilization | Current | +30% | Parallel delegation usage |

---

## File Structure

```
src/the-vibes/
├── core/
│   ├── agent.ts              # Enhance: cache optimization
│   └── types.ts              # Add: planning types
├── middleware/
│   ├── planning.ts           # NEW: todo recitation
│   ├── reasoning.ts          # NEW: ToT, ReAct patterns
│   ├── semantic-memory.ts    # NEW: vector-based facts
│   ├── procedural-memory.ts  # NEW: pattern storage
│   ├── error-tracking.ts     # NEW: error retention
│   ├── swarm.ts              # NEW: decentralized collaboration
│   ├── memory.ts             # ENHANCE: reflexion
│   ├── subagent.ts           # ENHANCE: parallel delegation
│   └── tasks.ts              # ENHANCE: templates
└── backend/
    ├── statebackend.ts       # ENHANCE: templates
    └── vector-store.ts       # NEW: simple vector DB
```

---

## References

- [Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- [Deep Agents - LangChain Blog](https://www.blog.langchain.com/deep-agents/)
- [The Four Pillars of Deep Agents](https://prajnaaiwisdom.medium.com/the-four-pillars-of-deep-agents-planning-delegation-memory-context-59e40376dbc5)
- [Agentic Reasoning Patterns](https://servicesground.com/blog/agentic-reasoning-patterns/)
