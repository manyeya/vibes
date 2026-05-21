/**
 * In-memory registry for active streams. Per-stream entries track the
 * monotonic chunk sequence, completion state, and a fan-out subscriber
 * list so the reconnect endpoint (`GET /mimo-code/:sessionId/stream`) can
 * hand off a live tail to clients that drop and reconnect mid-stream.
 *
 * Pairs with `SqliteBackend.{appendStreamChunk, endStream, readStreamChunks}`
 * for the persisted-replay side of resumable streams.
 */

export type StreamChunkPayload = unknown;

export type StreamSubscriber = (seq: number, chunk: StreamChunkPayload) => void;
export type StreamEndSubscriber = (status: 'completed' | 'failed') => void;

export interface StreamRegistryEntry {
    streamId: string;
    sessionId: string;
    /** Monotonically increasing seq assigned to each chunk as it's emitted. */
    lastSeq: number;
    completed: boolean;
    status?: 'completed' | 'failed';
    endedAt?: number;
    subscribers: Set<StreamSubscriber>;
    endSubscribers: Set<StreamEndSubscriber>;
}

/**
 * Grace window an entry lingers in-memory after the stream ends so that a
 * fast reconnect can still pick up via the live tail handoff. After this
 * window, late reconnects fall through to the SQLite replay path.
 */
const COMPLETED_RETENTION_MS = 60_000;

export class StreamRegistry {
    private streams = new Map<string, StreamRegistryEntry>();

    create(streamId: string, sessionId: string): StreamRegistryEntry {
        const entry: StreamRegistryEntry = {
            streamId,
            sessionId,
            lastSeq: 0,
            completed: false,
            subscribers: new Set(),
            endSubscribers: new Set(),
        };
        this.streams.set(streamId, entry);
        return entry;
    }

    get(streamId: string): StreamRegistryEntry | undefined {
        return this.streams.get(streamId);
    }

    /**
     * Allocate the next seq and fan the chunk out to subscribers.
     * Callers should persist *before* calling emit so a reconnect that
     * arrives between the SQLite write and the in-memory fan-out can still
     * filter duplicates by seq.
     */
    emit(streamId: string, chunk: StreamChunkPayload): number {
        const entry = this.streams.get(streamId);
        if (!entry) return -1;
        entry.lastSeq += 1;
        const seq = entry.lastSeq;
        for (const sub of entry.subscribers) {
            try {
                sub(seq, chunk);
            } catch (err) {
                // Subscriber bugs must not poison the producer.
                console.error('[StreamRegistry] subscriber threw:', err);
            }
        }
        return seq;
    }

    /**
     * Mark a stream as completed. Notifies live subscribers, then schedules
     * the entry for eviction after `COMPLETED_RETENTION_MS` so future
     * reconnects fall back to SQLite replay rather than reading a stale
     * in-memory cursor.
     */
    complete(streamId: string, status: 'completed' | 'failed'): void {
        const entry = this.streams.get(streamId);
        if (!entry || entry.completed) return;
        entry.completed = true;
        entry.status = status;
        entry.endedAt = Date.now();
        for (const sub of entry.endSubscribers) {
            try { sub(status); } catch (err) { console.error('[StreamRegistry] end subscriber threw:', err); }
        }
        setTimeout(() => {
            // Only evict if no new stream has taken the slot.
            const current = this.streams.get(streamId);
            if (current === entry) this.streams.delete(streamId);
        }, COMPLETED_RETENTION_MS);
    }

    /**
     * Subscribe a reader to live chunks. Returns an unsubscribe function.
     * If the stream is already completed, `onEnd` fires synchronously and
     * the returned function is a no-op.
     */
    subscribe(
        streamId: string,
        onChunk: StreamSubscriber,
        onEnd: StreamEndSubscriber
    ): () => void {
        const entry = this.streams.get(streamId);
        if (!entry) {
            onEnd('completed');
            return () => {};
        }
        if (entry.completed) {
            onEnd(entry.status ?? 'completed');
            return () => {};
        }
        entry.subscribers.add(onChunk);
        entry.endSubscribers.add(onEnd);
        return () => {
            entry.subscribers.delete(onChunk);
            entry.endSubscribers.delete(onEnd);
        };
    }

    /** Number of currently tracked streams (active or in retention). */
    size(): number {
        return this.streams.size;
    }
}
