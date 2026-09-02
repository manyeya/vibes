export interface Task {
  id: string;
  title: string;
  status: string;
}

/** Just enough of a UI message to derive tasks from. */
interface MessageLike {
  role?: string;
  parts?: Array<{ type?: string; data?: unknown }>;
}

/**
 * Build the sticky task panel's list from the message stream.
 *
 * Two rules, both learned the hard way:
 *
 * 1. **The latest `task_graph` wins — it is not merged.** `emitTaskGraph` sends
 *    the COMPLETE current task list on every change, so each graph supersedes
 *    the one before it. Merging them means the panel can never shrink: after
 *    `clear_tasks` it would keep showing cleared tasks forever. (The web demo
 *    already does it this way; the TUI had drifted.)
 *
 * 2. **Only the current turn counts.** Scanning all history meant a plan
 *    abandoned turns ago — e.g. one killed mid-run, leaving tasks stranded —
 *    reappeared the moment the agent got busy on an unrelated message. Tasks
 *    from before the last user message are ignored; if this turn touched no
 *    tasks, the panel stays empty.
 */
export function deriveTasks(messages: MessageLike[]): Task[] {
  // Start at the last user message: everything after it belongs to this turn.
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') { start = i; break; }
  }

  let base: Task[] | null = null;
  const updates = new Map<string, Partial<Task>>();

  for (let i = start; i < messages.length; i++) {
    for (const p of messages[i]?.parts ?? []) {
      if (p?.type === 'data-task_graph') {
        const nodes = (p.data as { nodes?: Task[] } | undefined)?.nodes;
        if (Array.isArray(nodes)) {
          base = nodes.map((n) => ({ id: n.id, title: n.title, status: n.status }));
          // A newer snapshot is authoritative; updates seen before it are stale.
          updates.clear();
        }
      } else if (p?.type === 'data-task_update') {
        const d = p.data as { id?: string; title?: string; status?: string } | undefined;
        if (d?.id) {
          const prev = updates.get(d.id);
          updates.set(d.id, {
            id: d.id,
            ...(d.title !== undefined ? { title: d.title } : prev?.title !== undefined ? { title: prev.title } : {}),
            ...(d.status !== undefined ? { status: d.status } : prev?.status !== undefined ? { status: prev.status } : {}),
          });
        }
      }
    }
  }

  // No graph this turn: fall back to whatever updates arrived on their own.
  const map = new Map<string, Task>();
  for (const t of base ?? []) map.set(t.id, t);
  for (const [id, u] of updates) {
    const ex = map.get(id);
    // An update for a task the current graph doesn't know about is only shown
    // when there's no graph at all — otherwise the graph is authoritative.
    if (!ex && base) continue;
    map.set(id, { id, title: u.title ?? ex?.title ?? id, status: u.status ?? ex?.status ?? 'pending' });
  }
  return [...map.values()];
}
