/**
 * Forwards a sub-agent's live text/reasoning deltas to the parent's stream.
 *
 * Shared by both execution backends: the in-process one feeds it from the
 * child's `fullStream`, the worker one feeds it from IPC `stream-part` messages.
 * Keeping one implementation means the throttle and the final flush behave
 * identically whichever backend ran, so the UI can't tell them apart.
 */

type WriteFn = (part: { type: string; id: string; data: { text: string } }) => void;

/** Minimum ms between emits — raw deltas arrive far faster than the UI can use. */
const THROTTLE_MS = 60;

export class DeltaForwarder {
    private text = '';
    private reasoning = '';
    private lastEmit = 0;

    constructor(private readonly write: WriteFn) {}

    /** The accumulated final answer, authoritative when the stream was drained here. */
    get answer(): string {
        return this.text;
    }

    /** Feed one raw model stream part. Non-delta parts are ignored. */
    push(part: unknown): void {
        const p = part as { type?: string; text?: unknown } | null;
        const piece = typeof p?.text === 'string' ? p.text : '';
        if (!piece) return;
        if (p?.type === 'text-delta') {
            this.text += piece;
            this.emit(this.text, false);
        } else if (p?.type === 'reasoning-delta') {
            this.reasoning += piece;
            this.emit(this.reasoning, true);
        }
    }

    /** Emit whatever the throttle held back. Call once the stream is done. */
    finish(): void {
        if (this.text) this.emit(this.text, false, true);
        if (this.reasoning) this.emit(this.reasoning, true, true);
    }

    private emit(text: string, reasoning: boolean, force = false): void {
        const now = Date.now();
        if (!force && now - this.lastEmit < THROTTLE_MS) return;
        this.lastEmit = now;
        this.write({
            type: reasoning ? 'data-agent_thought' : 'data-agent_message',
            id: reasoning ? 'agent-thought' : 'agent-message',
            data: { text },
        });
    }
}
