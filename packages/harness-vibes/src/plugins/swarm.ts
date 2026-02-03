import {
    tool,
    type UIMessageStreamWriter,
} from 'ai';
import { z } from 'zod';
import { VibesUIMessage, Plugin } from '../core/types';

/**
 * A signal sent between agents.
 */
export interface AgentSignal {
    /** Unique signal ID */
    id: string;
    /** Sender agent identifier */
    from: string;
    /** Target agent identifier (empty = broadcast) */
    to: string;
    /** The signal/message */
    message: string;
    /** Signal type for routing */
    type: 'request' | 'response' | 'notification' | 'alert';
    /** When the signal was sent */
    timestamp: string;
    /** Associated data */
    data?: Record<string, any>;
    /** Whether this signal has been processed */
    processed: boolean;
}

/**
 * A shared state entry.
 */
export interface SharedStateEntry {
    /** Key for the state entry */
    key: string;
    /** Current value */
    value: any;
    /** Which agent last wrote this value */
    lastWriter: string;
    /** When this value was last updated */
    timestamp: string;
    /** How many times this value has been read */
    readCount: number;
    /** Optional TTL in milliseconds */
    ttl?: number;
}

/**
 * Configuration for SwarmPlugin
 */
export interface SwarmConfig {
    /** Maximum shared state entries (default: 100) */
    maxStateEntries?: number;
    /** Maximum signals to keep in history (default: 50) */
    maxSignalHistory?: number;
    /** Path to shared state persistence file (default: workspace/swarm-state.json) */
    statePath?: string;
    /** Whether to persist shared state (default: true) */
    persistState?: boolean;
}

/**
 * SwarmPlugin enables decentralized agent collaboration.
 *
 * Features:
 * - Shared state: Agents can read/write shared variables
 * - Signaling: Agents can send signals to each other
 * - Broadcast: Send signals to all agents
 * - State persistence: Shared state survives sessions
 *
 * This enables multi-agent collaboration without a central coordinator.
 * Agents can coordinate through shared state and signaling.
 */
export class SwarmPlugin implements Plugin {
    name = 'SwarmPlugin';

    private writer?: UIMessageStreamWriter<VibesUIMessage>;
    private config: Required<SwarmConfig>;
    private agentId: string;

    /** Shared state storage */
    private sharedState: Map<string, SharedStateEntry> = new Map();

    /** Signal history */
    private signalHistory: AgentSignal[] = [];

    /** Pending signals (not yet processed) */
    private pendingSignals: Map<string, AgentSignal[]> = new Map();

    constructor(
        agentId: string = 'default',
        config: SwarmConfig = {}
    ) {
        this.agentId = agentId;
        this.config = {
            maxStateEntries: config.maxStateEntries || 100,
            maxSignalHistory: config.maxSignalHistory || 50,
            statePath: config.statePath || 'workspace/swarm-state.json',
            persistState: config.persistState !== false,
        };
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.writer = writer;
    }

    /**
     * Get agent ID
     */
    getAgentId(): string {
        return this.agentId;
    }

    /**
     * Set agent ID
     */
    setAgentId(id: string): void {
        this.agentId = id;
    }

    /**
     * Get shared state value
     */
    getSharedState(key: string): any {
        const entry = this.sharedState.get(key);
        if (entry) {
            // Check TTL
            if (entry.ttl && Date.now() - new Date(entry.timestamp).getTime() > entry.ttl) {
                this.sharedState.delete(key);
                return undefined;
            }
            entry.readCount++;
            return entry.value;
        }
        return undefined;
    }

    /**
     * Set shared state value
     */
    setSharedState(key: string, value: any, ttl?: number): void {
        const entry: SharedStateEntry = {
            key,
            value,
            lastWriter: this.agentId,
            timestamp: new Date().toISOString(),
            readCount: 0,
            ttl,
        };

        this.sharedState.set(key, entry);

        // Trim if over limit
        if (this.sharedState.size > this.config.maxStateEntries) {
            const entries = Array.from(this.sharedState.values());
            // Remove least recently read entries
            entries.sort((a, b) => a.readCount - b.readCount);
            const toRemove = entries.slice(0, entries.length - this.config.maxStateEntries);
            for (const e of toRemove) {
                this.sharedState.delete(e.key);
            }
        }

        // Persist if enabled
        if (this.config.persistState) {
            this.persistState();
        }
    }

    /**
     * Get signals for this agent
     */
    getSignals(includeProcessed: boolean = false): AgentSignal[] {
        return this.signalHistory.filter(s =>
            (s.to === this.agentId || s.to === 'broadcast' || s.to === '') &&
            (includeProcessed || !s.processed)
        );
    }

    /**
     * Get pending signals for this agent
     */
    getPendingSignals(): AgentSignal[] {
        return this.pendingSignals.get(this.agentId) || [];
    }

    /**
     * Clear pending signals for this agent
     */
    clearPendingSignals(): void {
        this.pendingSignals.set(this.agentId, []);
    }

    /**
     * Tools provided by the swarm plugin
     */
    get tools() {
        return {
            // Shared state tools
            write_shared_state: tool({
                description: `Write a value to shared state for other agents to read.
Use this to share information, results, or coordination data with other agents.`,
                inputSchema: z.object({
                    key: z.string().describe('Key for the shared state value'),
                    value: z.any().describe('Value to store (can be string, number, object, array)'),
                    ttl: z.number().optional().describe('Time-to-live in milliseconds (optional)'),
                }),
                execute: async ({ key, value, ttl }) => {
                    const previous = this.getSharedState(key);
                    this.setSharedState(key, value, ttl);

                    this.notifyStatus(`Shared state updated: ${key} = ${JSON.stringify(value).slice(0, 50)}`);

                    return {
                        success: true,
                        key,
                        previousValue: previous,
                        message: `Shared state "${key}" updated`,
                    };
                },
            }),

            read_shared_state: tool({
                description: `Read a value from shared state.
Use this to get information written by other agents.`,
                inputSchema: z.object({
                    key: z.string().describe('Key to read from shared state'),
                }),
                execute: async ({ key }) => {
                    const value = this.getSharedState(key);
                    const entry = this.sharedState.get(key);

                    return {
                        success: true,
                        key,
                        value,
                        exists: entry !== undefined,
                        lastWriter: entry?.lastWriter,
                        timestamp: entry?.timestamp,
                        readCount: entry?.readCount || 0,
                        message: value !== undefined
                            ? `Shared state "${key}" retrieved`
                            : `Shared state "${key}" not found`,
                    };
                },
            }),

            list_shared_state: tool({
                description: `List all shared state entries.
Use this to see what information agents have shared.`,
                inputSchema: z.object({
                    prefix: z.string().optional().describe('Filter by key prefix'),
                }),
                execute: async ({ prefix }) => {
                    let entries = Array.from(this.sharedState.values());

                    if (prefix) {
                        entries = entries.filter(e => e.key.startsWith(prefix));
                    }

                    return {
                        success: true,
                        entries: entries.map(e => ({
                            key: e.key,
                            value: e.value,
                            lastWriter: e.lastWriter,
                            timestamp: e.timestamp,
                            readCount: e.readCount,
                            hasTTL: !!e.ttl,
                        })),
                        count: entries.length,
                        message: `Found ${entries.length} shared state entries`,
                    };
                },
            }),

            delete_shared_state: tool({
                description: `Remove a value from shared state.
Use this to clean up old or unused shared data.`,
                inputSchema: z.object({
                    key: z.string().describe('Key to remove from shared state'),
                }),
                execute: async ({ key }) => {
                    const existed = this.sharedState.delete(key);

                    if (this.config.persistState) {
                        this.persistState();
                    }

                    return {
                        success: true,
                        existed,
                        message: existed
                            ? `Shared state "${key}" removed`
                            : `Shared state "${key}" did not exist`,
                    };
                },
            }),

            // Signaling tools
            signal: tool({
                description: `Send a signal to another agent or broadcast to all agents.
Signals are messages that agents can send to coordinate their work.`,
                inputSchema: z.object({
                    to: z.string().describe('Target agent ID (use "broadcast" for all agents)'),
                    message: z.string().describe('The signal/message to send'),
                    type: z.enum(['request', 'response', 'notification', 'alert']).default('notification').describe('Signal type'),
                    data: z.record(z.string(), z.any()).optional().describe('Additional data to attach to the signal'),
                }),
                execute: async ({ to, message, type, data }) => {
                    const signal: AgentSignal = {
                        id: `signal_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
                        from: this.agentId,
                        to,
                        message,
                        type,
                        timestamp: new Date().toISOString(),
                        data,
                        processed: false,
                    };

                    // Add to history
                    this.signalHistory.push(signal);

                    // Trim history if over limit
                    if (this.signalHistory.length > this.config.maxSignalHistory) {
                        this.signalHistory = this.signalHistory.slice(-this.config.maxSignalHistory);
                    }

                    // Add to recipient's pending signals
                    if (to === 'broadcast') {
                        // Broadcast to all agents (in a real swarm, would send to all known agents)
                        // For now, mark as broadcast so any agent can receive it
                    } else {
                        if (!this.pendingSignals.has(to)) {
                            this.pendingSignals.set(to, []);
                        }
                        this.pendingSignals.get(to)!.push(signal);
                    }

                    this.notifyStatus(`Signal sent to ${to}: ${message.slice(0, 50)}`);

                    return {
                        success: true,
                        signalId: signal.id,
                        message: `Signal sent to ${to}`,
                    };
                },
            }),

            get_signals: tool({
                description: `Get pending signals sent to this agent.
Use this to check for signals from other agents.`,
                inputSchema: z.object({
                    includeProcessed: z.boolean().default(false).describe('Include already processed signals'),
                    markAsProcessed: z.boolean().default(true).describe('Mark retrieved signals as processed'),
                }),
                execute: async ({ includeProcessed, markAsProcessed }) => {
                    const signals = this.getSignals(includeProcessed);

                    if (markAsProcessed) {
                        for (const signal of signals) {
                            signal.processed = true;
                        }
                    }

                    // Clear from pending
                    this.clearPendingSignals();

                    return {
                        success: true,
                        signals: signals.map(s => ({
                            id: s.id,
                            from: s.from,
                            to: s.to,
                            message: s.message,
                            type: s.type,
                            timestamp: s.timestamp,
                            data: s.data,
                            processed: s.processed,
                        })),
                        count: signals.length,
                        message: `Retrieved ${signals.length} signal${signals.length !== 1 ? 's' : ''}`,
                    };
                },
            }),

            send_broadcast: tool({
                description: `Broadcast a message to all agents in the swarm.
Use this for announcements or shared coordination needs.`,
                inputSchema: z.object({
                    message: z.string().describe('Message to broadcast'),
                    type: z.enum(['notification', 'alert']).default('notification').describe('Broadcast type'),
                    data: z.record(z.string(), z.any()).optional().describe('Additional data'),
                }),
                execute: async ({ message, type, data }) => {
                    const signal: AgentSignal = {
                        id: `signal_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
                        from: this.agentId,
                        to: 'broadcast',
                        message,
                        type,
                        timestamp: new Date().toISOString(),
                        data,
                        processed: false,
                    };

                    this.signalHistory.push(signal);

                    this.notifyStatus(`Broadcast: ${message.slice(0, 50)}`);

                    return {
                        success: true,
                        signalId: signal.id,
                        message: 'Broadcast sent to all agents',
                    };
                },
            }),

            // Coordination tools
            propose_task: tool({
                description: `Propose a task for the swarm to work on collaboratively.
Use this to suggest work that multiple agents could contribute to.`,
                inputSchema: z.object({
                    task: z.string().describe('The task to propose'),
                    priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
                    skills: z.array(z.string()).optional().describe('Skills/roles needed'),
                    description: z.string().optional().describe('Detailed description of the task'),
                }),
                execute: async ({ task, priority, skills, description }) => {
                    const proposalKey = `task_proposal:${Date.now()}`;
                    const proposal = {
                        task,
                        priority,
                        skills: skills || [],
                        description,
                        proposedBy: this.agentId,
                        timestamp: new Date().toISOString(),
                        status: 'proposed',
                    };

                    this.setSharedState(proposalKey, proposal);

                    // Broadcast the proposal
                    const signal: AgentSignal = {
                        id: `signal_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
                        from: this.agentId,
                        to: 'broadcast',
                        message: `Task proposal: ${task}`,
                        type: 'request',
                        timestamp: new Date().toISOString(),
                        data: { proposalKey, proposal },
                        processed: false,
                    };

                    this.signalHistory.push(signal);

                    this.notifyStatus(`Task proposal: ${task}`);

                    return {
                        success: true,
                        proposalKey,
                        signalId: signal.id,
                        message: `Task proposal created and broadcasted`,
                    };
                },
            }),

            claim_task: tool({
                description: `Claim a proposed task to work on.
Use this after seeing a task proposal to indicate you will work on it.`,
                inputSchema: z.object({
                    proposalKey: z.string().describe('Key of the proposal to claim'),
                }),
                execute: async ({ proposalKey }) => {
                    const proposal = this.getSharedState(proposalKey);
                    if (!proposal || proposal.status !== 'proposed') {
                        return {
                            success: false,
                            error: 'Task proposal not found or already claimed',
                        };
                    }

                    proposal.status = 'claimed';
                    proposal.claimedBy = this.agentId;
                    proposal.claimedAt = new Date().toISOString();

                    this.setSharedState(proposalKey, proposal);

                    // Signal that task was claimed
                    const signal: AgentSignal = {
                        id: `signal_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
                        from: this.agentId,
                        to: 'broadcast',
                        message: `Task claimed: ${proposal.task}`,
                        type: 'notification',
                        timestamp: new Date().toISOString(),
                        data: { proposalKey, claimedBy: this.agentId },
                        processed: false,
                    };

                    this.signalHistory.push(signal);

                    this.notifyStatus(`Task claimed: ${proposal.task}`);

                    return {
                        success: true,
                        proposal,
                        message: `Task "${proposal.task}" claimed`,
                    };
                },
            }),

            complete_task: tool({
                description: `Mark a proposed task as completed.
Use this after finishing work on a claimed task.`,
                inputSchema: z.object({
                    proposalKey: z.string().describe('Key of the proposal to complete'),
                    result: z.string().describe('Summary of what was accomplished'),
                }),
                execute: async ({ proposalKey, result }) => {
                    const proposal = this.getSharedState(proposalKey);
                    if (!proposal) {
                        return {
                            success: false,
                            error: 'Task proposal not found',
                        };
                    }

                    proposal.status = 'completed';
                    proposal.completedBy = this.agentId;
                    proposal.completedAt = new Date().toISOString();
                    proposal.result = result;

                    this.setSharedState(proposalKey, proposal);

                    // Signal completion
                    const signal: AgentSignal = {
                        id: `signal_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
                        from: this.agentId,
                        to: 'broadcast',
                        message: `Task completed: ${proposal.task}`,
                        type: 'notification',
                        timestamp: new Date().toISOString(),
                        data: { proposalKey, completedBy: this.agentId, result },
                        processed: false,
                    };

                    this.signalHistory.push(signal);

                    this.notifyStatus(`Task completed: ${proposal.task}`);

                    return {
                        success: true,
                        proposal,
                        message: `Task "${proposal.task}" marked as complete`,
                    };
                },
            }),

            // Swarm state tools
            get_swarm_status: tool({
                description: `Get the current status of the swarm.
Shows shared state, pending signals, and active task proposals.`,
                inputSchema: z.object({}),
                execute: async () => {
                    const taskProposals = Array.from(this.sharedState.values())
                        .filter(e => e.key.startsWith('task_proposal:') && e.value.status !== 'completed');

                    return {
                        success: true,
                        agentId: this.agentId,
                        sharedStateEntries: this.sharedState.size,
                        pendingSignals: this.getPendingSignals().length,
                        signalHistory: this.signalHistory.length,
                        activeTaskProposals: taskProposals.length,
                        taskProposals: taskProposals.map(e => ({
                            key: e.key,
                            ...e.value,
                        })),
                        message: `Swarm status retrieved`,
                    };
                },
            }),
        };
    }

    /**
     * Modify system prompt to mention swarm capabilities
     */
    modifySystemPrompt(prompt: string): string {
        return `${prompt}

## Swarm Collaboration

You are part of a multi-agent swarm. You can coordinate with other agents through:

- **Shared State**: Use \`write_shared_state()\` to share information, \`read_shared_state()\` to read what others have shared
- **Signaling**: Use \`signal()\` to send messages to specific agents, \`send_broadcast()\` for announcements
- **Coordination**: Use \`propose_task()\` to suggest work, \`claim_task()\` to take on work, \`complete_task()\` when done

**Agent ID**: \`${this.agentId}\`

Use \`get_signals()\` to check for signals from other agents.
Use \`get_swarm_status()\` to see overall swarm state.
`;
    }

    /**
     * Persist shared state to file
     */
    private async persistState(): Promise<void> {
        if (!this.config.persistState) return;

        try {
            const fs = await import('fs/promises');
            const pathModule = await import('path');
            const fullPath = pathModule.resolve(process.cwd(), this.config.statePath);

            await fs.mkdir(pathModule.dirname(fullPath), { recursive: true });

            const stateToSave = {
                sharedState: Array.from(this.sharedState.entries()),
                signalHistory: this.signalHistory,
                timestamp: new Date().toISOString(),
            };

            await fs.writeFile(fullPath, JSON.stringify(stateToSave, null, 2));
        } catch (e) {
            console.error('Failed to persist swarm state:', e);
        }
    }

    /**
     * Load shared state from file
     */
    private async loadState(): Promise<void> {
        try {
            const fs = await import('fs/promises');
            const pathModule = await import('path');
            const fullPath = pathModule.resolve(process.cwd(), this.config.statePath);

            const content = await fs.readFile(fullPath, 'utf-8');
            const loaded = JSON.parse(content);

            // Restore shared state
            if (loaded.sharedState) {
                for (const [key, entry] of loaded.sharedState) {
                    // Check TTL on load
                    const stateEntry = entry as SharedStateEntry;
                    if (!stateEntry.ttl || Date.now() - new Date(stateEntry.timestamp).getTime() <= stateEntry.ttl) {
                        this.sharedState.set(key, stateEntry);
                    }
                }
            }

            // Restore signal history
            if (loaded.signalHistory) {
                this.signalHistory = loaded.signalHistory;
            }
        } catch (e) {
            // File doesn't exist or is invalid - start fresh
            this.sharedState.clear();
            this.signalHistory = [];
        }
    }

    /**
     * Notify UI of status changes
     */
    private notifyStatus(message: string) {
        this.writer?.write({
            type: 'data-status',
            data: { message },
        });
    }

    /**
     * Initialization: load existing state
     */
    async waitReady(): Promise<void> {
        await this.loadState();
    }
}

export default SwarmPlugin;
