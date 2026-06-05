/**
 * Stream coordinator. Owns ONLY the HTTP streaming-transport state:
 *   - per-session AbortControllers for the active stream
 *   - the in-memory `StreamRegistry` used for live-tail reconnects
 *   - periodic cleanup of the persisted stream_log
 *
 * Session identity, workspaces, persisted message state, and agent
 * instances are owned by the harness (`vibeHarness`) — NOT here. This used
 * to be `APISessionManager`, which duplicated the harness's session
 * handling; that responsibility now lives in one place.
 */

import { SqliteBackend } from '../../../packages/harness-vibes/index';
import { StreamRegistry } from './stream-registry';

/**
 * Per-session abort controller registry entry.
 * Holds the controller for the session's currently-active stream.
 */
interface StreamControllerEntry {
    controller: AbortController;
    startedAt: number;
}

class StreamCoordinator {
    private streamControllers: Map<string, StreamControllerEntry> = new Map();

    /**
     * In-memory registry of active streams. Used by the streaming route to
     * publish chunks for live-tail reconnects and by the reconnect endpoint
     * to subscribe to those chunks.
     */
    public readonly streamRegistry: StreamRegistry = new StreamRegistry();

    constructor() {
        // Periodically drop persisted stream_log rows older than 1 hour.
        setInterval(() => this.cleanupStreamLogs(), 30 * 60 * 1000);
    }

    /**
     * Drop persisted stream_log rows older than 1 hour. Keeps the SQLite
     * table from growing unbounded; the replay TTL in the reconnect
     * endpoint is shorter (5 min) so this is a safety net.
     */
    private cleanupStreamLogs(): void {
        try {
            const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            const backend = new SqliteBackend('workspace/vibes.db', 'default');
            const deleted = backend.cleanupStreams(cutoff);
            backend.close();
            if (deleted > 0) {
                console.log(`[StreamCoordinator] Cleaned up ${deleted} old stream_log rows`);
            }
        } catch (err) {
            console.error('[StreamCoordinator] stream log cleanup failed:', err);
        }
    }

    /**
     * Register an AbortController for a session's active stream. If the
     * session already has a registered controller, abort the previous one
     * (newest-wins) so a stray stream does not get orphaned.
     */
    registerStreamController(sessionId: string, controller: AbortController): void {
        const existing = this.streamControllers.get(sessionId);
        if (existing && existing.controller !== controller) {
            existing.controller.abort(new Error('superseded by new stream'));
        }
        this.streamControllers.set(sessionId, { controller, startedAt: Date.now() });
    }

    /**
     * Clear a session's stream controller if it matches the supplied one.
     * A mismatch means a newer stream already took the slot — leave it alone.
     */
    clearStreamController(sessionId: string, controller: AbortController): void {
        const existing = this.streamControllers.get(sessionId);
        if (existing && existing.controller === controller) {
            this.streamControllers.delete(sessionId);
        }
    }

    /**
     * Abort the session's currently-active stream, if any.
     * Returns true if a stream was aborted, false if nothing was running.
     */
    abortStream(sessionId: string, reason?: string): boolean {
        const existing = this.streamControllers.get(sessionId);
        if (!existing) return false;
        existing.controller.abort(new Error(reason ?? 'client requested abort'));
        this.streamControllers.delete(sessionId);
        return true;
    }
}

/** Global stream coordinator instance. */
export const streamCoordinator = new StreamCoordinator();
export default streamCoordinator;
