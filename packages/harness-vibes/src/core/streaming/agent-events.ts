import type { UIMessageStreamWriter } from 'ai';
import type { VibesUIMessage } from './streaming';

/**
 * The event-emitter seam (pi's `Agent.subscribe()`, adapted to our writer).
 *
 * Every structured thing the agent emits already funnels through
 * `DataStreamWriter` → `rawWriter.write(part)`. Rather than model a parallel
 * event type, an {@link AgentEvent} simply *is* that data part — it's already a
 * typed union ({ type: 'data-command', data }, { type: 'data-delegation', … }).
 * The bus makes those observable OFF the UI stream, so a test, a logger, or a
 * non-UI transport can watch a run without parsing rendered output.
 *
 * Wire it with {@link teeToBus}: every write publishes to the bus AND forwards
 * to the real UI writer (or to nothing, for headless runs). Zero changes to the
 * ~20 `write*` methods — the tee sits under all of them.
 */
export type AgentEvent = Parameters<UIMessageStreamWriter<VibesUIMessage>['write']>[0];

export type AgentEventListener = (event: AgentEvent) => void;

/** Synchronous fan-out. One per agent; lives for the agent's lifetime. */
export class AgentEventBus {
    private readonly listeners = new Set<AgentEventListener>();

    /** Observe every event. Returns an unsubscribe. */
    subscribe(listener: AgentEventListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** True when someone is watching — lets the agent skip headless context setup otherwise. */
    get hasListeners(): boolean {
        return this.listeners.size > 0;
    }

    emit(event: AgentEvent): void {
        for (const listener of this.listeners) {
            // A misbehaving subscriber must never break the agent run.
            try {
                listener(event);
            } catch {
                /* swallow */
            }
        }
    }
}

/**
 * Wrap a UI writer so every `.write(part)` also publishes to `bus`. Pass a
 * nullish `writer` for a fully headless run — events still reach the bus, the
 * UI forward is just a no-op. `onError`/`merge` forward untouched.
 */
export function teeToBus(
    writer: UIMessageStreamWriter<VibesUIMessage> | null | undefined,
    bus: AgentEventBus,
): UIMessageStreamWriter<VibesUIMessage> {
    return {
        write(part) {
            bus.emit(part);
            writer?.write(part);
        },
        onError: writer?.onError,
        merge: writer?.merge ? writer.merge.bind(writer) : () => {},
    } as UIMessageStreamWriter<VibesUIMessage>;
}
