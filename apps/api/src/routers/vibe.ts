import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { resolve, dirname } from "path";
import os from "node:os";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { logger } from "../logger";
import streamCoordinator from "../stream-coordinator";
import { vibeRuntime, defaultSubAgents } from "../vibe-coder";
import { createAgentStreamResponse, validateWorkflow, runWorkflowToStream, createDataStreamWriter } from "../../../../packages/harness-vibes/index";
import { agent as simpleAgent } from "../simple-agent";
import { getModel, getAvailableModels, resolveContextWindow, getDefaultModelId, isKnownModelId } from "../model-factory";

/**
 * Loose message shape accepted by the streaming endpoints. AI SDK in
 * practice emits more roles than the spec lists (tool, function,
 * developer, system, …) and some message shapes appear with `parts` but
 * without `content`, or vice versa. We validate the minimum invariant —
 * `role` is a string and the message carries either `parts` or `content`
 * — and pass the rest through to the agent's `convertMessages`, which
 * already handles the union of UIMessage and ModelMessage.
 */
const messagePartSchema = z.object({
    type: z.string(),
}).passthrough();

const apiMessageSchema = z.object({
    id: z.string().optional(),
    role: z.string(),
    parts: z.array(messagePartSchema).optional(),
    content: z.union([z.string(), z.array(z.unknown())]).optional(),
}).passthrough().refine(
    (msg) => msg.parts !== undefined || msg.content !== undefined,
    { message: 'message must carry parts (UIMessage) or content (ModelMessage)' }
);

const vibeSchema = z.object({
    messages: z.array(apiMessageSchema),
    session_id: z.string().nullable().optional(),
    /** Optional per-request OpenRouter model id from the UI model selector. */
    model: z.string().nullable().optional(),
    /** Optional web-search backend preference from the UI settings ('auto' | 'exa' | 'tavily' | 'brave'). */
    search_provider: z.string().nullable().optional(),
    /** Optional execution mode from the UI ('plan' | 'manual' | 'auto-edit' | 'auto'). */
    mode: z.string().nullable().optional(),
}).passthrough();

type ApiMessage = z.infer<typeof apiMessageSchema>;

const app = new Hono();

/** Models available to the UI model selector + the current default. Pulls the
 *  live free OpenRouter catalog (grouped), with a curated fallback. */
app.get('/models', async (c) => {
    const models = await getAvailableModels();
    const preferred = getDefaultModelId();
    const active = models.some((m) => m.id === preferred) ? preferred : models[0]?.id;
    return c.json({ success: true, models, active });
});

/**
 * Apply a per-request model override to a session's agent. A valid id from
 * the selector swaps the model for this run; anything else reverts to the
 * agent's constructed default.
 */
async function applyModelOverride(
    agent: {
        setModelOverride: (m?: ReturnType<typeof getModel>) => void;
        setContextWindow: (w: number, r?: number) => void;
    },
    modelId: unknown,
): Promise<void> {
    const id = typeof modelId === 'string' && modelId.trim() ? modelId.trim() : undefined;
    const known = id ? isKnownModelId(id) : false;
    agent.setModelOverride(known ? getModel({ provider: 'openrouter', id: id! }) : undefined);
    // Keep the context gauge + compression threshold aligned with the active
    // model's real window — selector models range from a few k to 1M tokens, so
    // a window frozen to the startup default would make the gauge meaningless.
    // Await so the OpenRouter catalog is loaded before resolving: a stream that
    // beats the UI's GET /models would otherwise fall back to the 128k default.
    agent.setContextWindow(await resolveContextWindow(known ? id! : getDefaultModelId()));
}

/**
 * Apply the UI's web-search backend preference for this run. The plugin
 * validates the id and falls back to env auto-detection for 'auto' or any
 * unconfigured backend, so we pass it through verbatim.
 */
function applySearchProvider(agent: { setSearchProviderPreference: (p?: string) => void }, provider: unknown): void {
    agent.setSearchProviderPreference(typeof provider === 'string' && provider.trim() ? provider.trim() : undefined);
}


/** The roster of built-in sub-agents the UI can target a message at. */
app.get('/agents', (c) => {
    return c.json({
        success: true,
        agents: defaultSubAgents.map((a) => ({ name: a.name, description: a.description })),
    });
});

/** Discoverable skills (name + description from each skill's SKILL.md frontmatter). */
app.get('/skills', async (c) => {
    try {
        const dir = resolve(process.cwd(), process.env.SKILLS_DIR ?? 'skills');
        let subdirs: string[] = [];
        try {
            subdirs = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
        } catch {
            return c.json({ success: true, skills: [] }); // no skills dir → empty
        }
        const skills: Array<{ name: string; description?: string }> = [];
        for (const sub of subdirs) {
            try {
                const md = await readFile(resolve(dir, sub, 'SKILL.md'), 'utf8');
                const block = md.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? '';
                const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim() || sub;
                const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim();
                skills.push({ name, description });
            } catch {
                /* a folder without a SKILL.md isn't a skill */
            }
        }
        return c.json({ success: true, skills });
    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list skills');
        return c.json({ success: false, error: 'Failed to list skills' }, 500);
    }
});

/**
 * List the saved workflows (WorkflowPlugin library). The plugin persists them
 * to the shared workspace root as `workflows.json` — the same file every
 * session reads/writes — so the UI can browse them read-only without going
 * through a per-session agent instance.
 */
const WORKFLOWS_PATH = resolve(process.cwd(), 'workspace/workflows.json');

async function readWorkflowsFile(): Promise<any[]> {
    try {
        const parsed = JSON.parse(await readFile(WORKFLOWS_PATH, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function writeWorkflowsFile(list: unknown[]): Promise<void> {
    await mkdir(dirname(WORKFLOWS_PATH), { recursive: true });
    await writeFile(WORKFLOWS_PATH, JSON.stringify(list, null, 2), 'utf8');
}

const findWorkflow = (list: any[], nameOrId: string) => list.find((w) => w?.id === nameOrId || w?.name === nameOrId);
const newWorkflowId = () => `wf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

app.get('/workflows', async (c) => {
    try {
        return c.json({ success: true, workflows: await readWorkflowsFile() });
    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list workflows');
        return c.json({ success: false, error: 'Failed to list workflows' }, 500);
    }
});

/** Validate a (hand-authored) workflow definition without saving it. */
app.post('/workflows/validate', async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const { name = 'workflow', inputs = [], steps = [] } = body ?? {};
        const list = await readWorkflowsFile();
        const result = validateWorkflow({ name, inputs, steps }, (n) => findWorkflow(list, n));
        return c.json({ success: true, ...result });
    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to validate workflow');
        return c.json({ success: false, error: 'Failed to validate workflow' }, 500);
    }
});

/** Create (or overwrite) a workflow by hand — same validation as the agent's create_workflow. */
app.post('/workflows', async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const { name, slug, description = '', inputs = [], steps = [], tags = [], overwrite = false } = body ?? {};
        if (typeof name !== 'string' || !name.trim()) {
            return c.json({ success: false, error: 'name is required' }, 400);
        }
        const list = await readWorkflowsFile();
        const existing = findWorkflow(list, name);
        if (existing && !overwrite) {
            return c.json({ success: false, error: `A workflow named "${name}" already exists.` }, 409);
        }
        const validation = validateWorkflow({ name, inputs, steps }, (n) => findWorkflow(list, n));
        if (!validation.valid) {
            return c.json({ success: false, errors: validation.errors, warnings: validation.warnings }, 400);
        }
        const now = new Date().toISOString();
        const workflow = {
            id: existing?.id ?? newWorkflowId(),
            name,
            ...(typeof slug === 'string' && slug.trim() ? { slug: slug.trim() } : {}),
            description, tags, inputs, steps,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            version: existing ? (existing.version ?? 1) + 1 : 1,
        };
        await writeWorkflowsFile(existing ? list.map((w) => (w.id === existing.id ? workflow : w)) : [...list, workflow]);
        return c.json({ success: true, workflow, warnings: validation.warnings });
    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to create workflow');
        return c.json({ success: false, error: 'Failed to create workflow' }, 500);
    }
});

/** Update a workflow by id. */
app.put('/workflows/:id', async (c) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json().catch(() => ({}));
        const list = await readWorkflowsFile();
        const existing = list.find((w) => w?.id === id);
        if (!existing) return c.json({ success: false, error: 'Workflow not found' }, 404);
        const updated = {
            ...existing,
            name: body.name ?? existing.name,
            slug: body.slug !== undefined ? (typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : undefined) : existing.slug,
            description: body.description ?? existing.description,
            inputs: body.inputs ?? existing.inputs,
            steps: body.steps ?? existing.steps,
            tags: body.tags ?? existing.tags,
            updatedAt: new Date().toISOString(),
            version: (existing.version ?? 1) + 1,
        };
        const validation = validateWorkflow({ name: updated.name, inputs: updated.inputs, steps: updated.steps }, (n) => findWorkflow(list, n));
        if (!validation.valid) {
            return c.json({ success: false, errors: validation.errors, warnings: validation.warnings }, 400);
        }
        await writeWorkflowsFile(list.map((w) => (w.id === id ? updated : w)));
        return c.json({ success: true, workflow: updated, warnings: validation.warnings });
    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to update workflow');
        return c.json({ success: false, error: 'Failed to update workflow' }, 500);
    }
});

/** Delete a workflow by id. */
app.delete('/workflows/:id', async (c) => {
    try {
        const id = c.req.param('id');
        const list = await readWorkflowsFile();
        const next = list.filter((w) => w?.id !== id);
        if (next.length === list.length) return c.json({ success: false, error: 'Workflow not found' }, 404);
        await writeWorkflowsFile(next);
        return c.json({ success: true });
    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to delete workflow');
        return c.json({ success: false, error: 'Failed to delete workflow' }, 500);
    }
});

// ── saved prompts (reusable composer snippets — a slash-command provider) ──────
const PROMPTS_PATH = resolve(process.cwd(), 'workspace/prompts.json');
async function readPromptsFile(): Promise<any[]> {
    try { const parsed = JSON.parse(await readFile(PROMPTS_PATH, 'utf8')); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
}
async function writePromptsFile(list: unknown[]): Promise<void> {
    await mkdir(dirname(PROMPTS_PATH), { recursive: true });
    await writeFile(PROMPTS_PATH, JSON.stringify(list, null, 2), 'utf8');
}

app.get('/prompts', async (c) => {
    try { return c.json({ success: true, prompts: await readPromptsFile() }); }
    catch (error) { logger.error({ error: String(error) }, 'Failed to list prompts'); return c.json({ success: false, error: 'Failed to list prompts' }, 500); }
});

app.post('/prompts', async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const text = typeof body.body === 'string' ? body.body.trim() : '';
        if (!name || !text) return c.json({ success: false, error: 'name and body are required' }, 400);
        const list = await readPromptsFile();
        const now = new Date().toISOString();
        const prompt = { id: `prm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, body: text, tags: Array.isArray(body.tags) ? body.tags : [], createdAt: now, updatedAt: now };
        await writePromptsFile([...list, prompt]);
        return c.json({ success: true, prompt });
    } catch (error) { logger.error({ error: String(error) }, 'Failed to save prompt'); return c.json({ success: false, error: 'Failed to save prompt' }, 500); }
});

app.delete('/prompts/:id', async (c) => {
    try {
        const id = c.req.param('id');
        const list = await readPromptsFile();
        const next = list.filter((p) => p?.id !== id);
        if (next.length === list.length) return c.json({ success: false, error: 'Prompt not found' }, 404);
        await writePromptsFile(next);
        return c.json({ success: true });
    } catch (error) { logger.error({ error: String(error) }, 'Failed to delete prompt'); return c.json({ success: false, error: 'Failed to delete prompt' }, 500); }
});

// ============ SERVER FILESYSTEM BROWSING (folder picker) ============

/**
 * Browse server-side directories for the "open folder" workspace flow. A
 * browser's native dialog can't return a real server path (and the agent runs
 * here, not on the client), so the picker walks the *server's* filesystem.
 * Returns the resolved dir, its parent, and the child directories.
 */
app.get('/fs/list', async (c) => {
    try {
        const raw = c.req.query('path');
        const target = raw && raw.trim() ? resolve(raw.trim()) : os.homedir();
        const dirents = await readdir(target, { withFileTypes: true });
        const entries = dirents
            .filter((d) => d.isDirectory())
            .map((d) => ({ name: d.name, isDir: true }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const parent = dirname(target);
        return c.json({
            success: true,
            path: target,
            parent: parent === target ? null : parent,
            home: os.homedir(),
            entries,
        });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return c.json({ success: false, error: msg }, 400);
    }
});

/**
 * Native OS folder dialog (macOS only). Pops Finder's "choose folder" on the
 * server host and returns the chosen absolute path. Useful when the API runs
 * on the same machine as the user (the local-dev default).
 */
app.post('/fs/pick-native', async (c) => {
    try {
        if (process.platform !== 'darwin') {
            return c.json({ success: false, error: 'Native picker is only available on macOS.' }, 400);
        }
        const proc = Bun.spawn(['osascript', '-e', 'POSIX path of (choose folder with prompt "Choose a project folder")'], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const out = (await new Response(proc.stdout).text()).trim();
        await proc.exited;
        if (!out) return c.json({ success: false, error: 'No folder chosen.' }, 400);
        return c.json({ success: true, path: out });
    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Native folder picker failed');
        return c.json({ success: false, error: 'Native picker failed.' }, 500);
    }
});

// ============ WORKSPACE (project) MANAGEMENT ENDPOINTS ============

/** List all workspaces (with session counts). */
app.get('/workspaces', async (c) => {
    try {
        const workspaces = await vibeRuntime.listWorkspaces();
        return c.json({ success: true, workspaces });
    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list workspaces');
        return c.json({ success: false, error: 'Failed to list workspaces' }, 500);
    }
});

/**
 * Create a workspace. Body: { name?, rootDir?, metadata? }.
 *  - app-managed: provide `name` (fresh project dir under workspace/projects).
 *  - open folder: provide `rootDir` (an EXISTING dir on disk, Codex-style);
 *    `name` then defaults to the folder's basename.
 */
app.post('/workspaces', async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined;
        const rootDir = typeof body.rootDir === 'string' && body.rootDir.trim() ? body.rootDir.trim() : undefined;
        if (!name && !rootDir) return c.json({ success: false, error: 'name or rootDir is required' }, 400);

        const workspace = await vibeRuntime.createWorkspace({ name, rootDir, metadata: body.metadata || {} });
        return c.json({ success: true, workspace });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg }, 'Failed to create workspace');
        // A bad/missing folder path is a client error, not a server fault.
        const clientError = /Not a directory/.test(msg);
        return c.json({ success: false, error: clientError ? msg : 'Failed to create workspace' }, clientError ? 400 : 500);
    }
});

/** Get one workspace. */
app.get('/workspaces/:id', async (c) => {
    try {
        const workspace = await vibeRuntime.getWorkspace(c.req.param('id'));
        if (!workspace) return c.json({ success: false, error: 'Workspace not found' }, 404);
        return c.json({ success: true, workspace });
    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to get workspace');
        return c.json({ success: false, error: 'Failed to get workspace' }, 500);
    }
});

/**
 * Git status of a workspace's project dir, for the status bar: the current
 * branch and whether the tree is dirty. Returns `{ git: null }` when the dir
 * isn't a git repo (or git isn't available) — the UI just omits the branch.
 */
app.get('/workspaces/:id/git', async (c) => {
    try {
        const workspace = await vibeRuntime.getWorkspace(c.req.param('id'));
        if (!workspace) return c.json({ success: false, error: 'Workspace not found' }, 404);

        const runGit = async (args: string[]): Promise<string | null> => {
            try {
                const proc = Bun.spawn(['git', '-C', workspace.rootDir, ...args], { stdout: 'pipe', stderr: 'ignore' });
                const out = await new Response(proc.stdout).text();
                return (await proc.exited) === 0 ? out : null;
            } catch {
                return null;
            }
        };

        const branchOut = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
        if (branchOut === null) return c.json({ success: true, git: null }); // not a repo
        const branch = branchOut.trim() || 'HEAD';
        const statusOut = await runGit(['status', '--porcelain']);
        const dirty = !!statusOut && statusOut.trim().length > 0;
        return c.json({ success: true, git: { branch, dirty } });
    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to read workspace git');
        return c.json({ success: false, error: 'Failed to read workspace git' }, 500);
    }
});

/** Rename / update a workspace. Body: { name?, metadata? }. */
app.patch('/workspaces/:id', async (c) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json().catch(() => ({}));
        await vibeRuntime.updateWorkspace(id, { name: body.name, metadata: body.metadata });
        const workspace = await vibeRuntime.getWorkspace(id);
        return c.json({ success: true, workspace });
    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to update workspace');
        return c.json({ success: false, error: 'Failed to update workspace' }, 500);
    }
});

/** Delete a workspace, its sessions, and its project directory. */
app.delete('/workspaces/:id', async (c) => {
    try {
        const id = c.req.param('id');
        if (id === 'default') {
            return c.json({ success: false, error: 'The Default workspace cannot be deleted.' }, 400);
        }
        await vibeRuntime.deleteWorkspace(id);
        return c.json({ success: true });
    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to delete workspace');
        return c.json({ success: false, error: 'Failed to delete workspace' }, 500);
    }
});

// ============ SESSION MANAGEMENT ENDPOINTS ============

/**
 * List sessions, optionally scoped to one workspace (?workspace_id=).
 */
app.get('/sessions', async (c) => {
    try {
        const workspaceId = c.req.query('workspace_id') || undefined;
        const sessions = await vibeRuntime.listSessions(workspaceId);
        return c.json({
            success: true,
            sessions,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to list sessions');

        return c.json({
            success: false,
            error: 'Failed to list sessions',
        }, 500);
    }
});

/**
 * Get a specific session
 */
app.get('/sessions/:id', async (c) => {
    try {
        const sessionId = c.req.param('id');
        const session = await vibeRuntime.getSessionInfo(sessionId);

        if (!session) {
            return c.json({
                success: false,
                error: 'Session not found',
            }, 404);
        }

        return c.json({
            success: true,
            session: {
                ...session
            },
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to get session');

        return c.json({
            success: false,
            error: 'Failed to get session',
        }, 500);
    }
});

/**
 * Create a new session
 */
app.post('/sessions', async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const title = body.title;
        const metadata = body.metadata || {};
        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined;

        const sessionId = await vibeRuntime.createSession({ title, metadata, workspaceId });

        return c.json({
            success: true,
            sessionId,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to create session');

        return c.json({
            success: false,
            error: 'Failed to create session',
        }, 500);
    }
});

/**
 * Delete a session
 */
app.delete('/sessions/:id', async (c) => {
    try {
        const sessionId = c.req.param('id');
        await vibeRuntime.deleteSession(sessionId);

        return c.json({
            success: true,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to delete session');

        return c.json({
            success: false,
            error: 'Failed to delete session',
        }, 500);
    }
});

/**
 * Abort the session's currently-active stream, if any.
 */
app.post('/sessions/:id/abort', async (c) => {
    try {
        const sessionId = c.req.param('id');
        const aborted = streamCoordinator.abortStream(sessionId, 'client requested abort');
        return c.json({ success: true, aborted });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to abort stream');
        return c.json({ success: false, error: 'Failed to abort stream' }, 500);
    }
});

/**
 * Update session metadata
 */
app.patch('/sessions/:id', async (c) => {
    try {
        const sessionId = c.req.param('id');
        const body = await c.req.json().catch(() => ({}));

        await vibeRuntime.updateSession(sessionId, {
            title: body.title,
            summary: body.summary,
            metadata: body.metadata,
        });

        const updated = await vibeRuntime.getSessionInfo(sessionId);

        return c.json({
            success: true,
            session: updated,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to update session');

        return c.json({
            success: false,
            error: 'Failed to update session',
        }, 500);
    }
});

/**
 * Get files for a session
 */
app.get('/sessions/:id/files', async (c) => {
    try {
        const sessionId = c.req.param('id');

        return c.json({
            success: true,
            files: (await vibeRuntime.readState(sessionId)).messages,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to get session files');

        return c.json({
            success: false,
            error: 'Failed to get session files',
        }, 500);
    }
});

/**
 * Get messages for a session (for loading chat history)
 *
 * IMPORTANT: this endpoint serves UIMessages back to `useChat`, which will
 * resend them on the next user turn. ModelMessage shapes that round-trip
 * badly (role:'tool', orphan tool-call parts without their matching
 * tool-result) are stripped here — leave them in and the next request
 * to any provider that doesn't natively accept role:'tool' messages
 * (e.g. some OpenRouter-routed models) returns "Unsupported role: tool".
 *
 * Tool runs are visible LIVE during a session via the streaming data
 * parts; on reload we keep only the user/assistant text exchange.
 */
app.get('/sessions/:id/messages', async (c) => {
    try {
        const sessionId = c.req.param('id');

        // Prefer the persisted full UI messages — their parts include the
        // data-* activity (ToT thoughts, tool progress, delegation, status),
        // so a reload restores the whole thread, not just text.
        const storedUi = await vibeRuntime.readUIMessages(sessionId);
        if (storedUi && storedUi.length > 0) {
            return c.json({ success: true, messages: storedUi });
        }

        // Fallback for sessions persisted before UI-message storage existed:
        // reconstruct the user/assistant text + reasoning from model messages.
        const state = await vibeRuntime.readState(sessionId);

        const messages = state.messages
            // Drop role:'tool' messages — UIMessage doesn't have a tool
            // role, and their content (tool results) can't be replayed
            // without the matching tool-call context.
            .filter((msg: any) => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system')
            .map((msg: any, index: number) => {
                let parts: Array<{ type: string; text: string }>;

                if (typeof msg.content === 'string') {
                    parts = [{ type: 'text', text: msg.content }];
                } else if (Array.isArray(msg.content)) {
                    // Keep only displayable text / reasoning parts. Tool-call
                    // parts on assistant messages would be orphaned without
                    // their matching tool-result, so the provider rejects
                    // the next turn — strip them.
                    parts = msg.content
                        .filter((p: any) => {
                            const t = p?.type;
                            return t === 'text' || t === 'reasoning' || t === 'thinking';
                        })
                        .map((p: any) => ({
                            type: p.type === 'text' ? 'text' : 'reasoning',
                            text: p.text ?? p.reasoning ?? '',
                        }))
                        .filter((p: { text: string }) => p.text.length > 0);
                } else {
                    parts = [{ type: 'text', text: String(msg.content) }];
                }

                if (parts.length === 0) return null;
                return {
                    id: `msg_${sessionId}_${index}`,
                    role: msg.role,
                    parts,
                };
            })
            .filter((m): m is { id: string; role: string; parts: Array<{ type: string; text: string }> } => m !== null);

        return c.json({
            success: true,
            messages,
            summary: state.summary,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Failed to get session messages');

        return c.json({
            success: false,
            error: 'Failed to get session messages',
        }, 500);
    }
});

// ============ AGENT INTERACTION ENDPOINTS ============

app.post('/vibe', zValidator('json', vibeSchema), async (c) => {
    try {
        const body = c.req.valid('json');
        const sessionId = body.session_id || 'default';

        logger.info({ messages: body.messages, sessionId }, 'Vibe agent request received');

        const agent = (await vibeRuntime.session(sessionId)).raw;
        await applyModelOverride(agent, body.model);
        applySearchProvider(agent, body.search_provider);
        if (body.mode) agent.setMode(body.mode, 'user');

        const startTime = Date.now();
        // The agent's `generate({messages})` overload accepts ModelMessage[]
        // | UIMessage[]; our zod schema validates the looser API shape and
        // the agent re-converts at the call boundary via convertMessages.
        // The single cast here is honest about that boundary handoff.
        type GenerateOpts = Parameters<typeof agent.generate>[0];
        const result = await agent.generate({
            messages: body.messages,
        } as unknown as GenerateOpts);
        const duration = Date.now() - startTime;

        const lastMessage = result.state.messages[result.state.messages.length - 1];
        // `ModelMessage.content` is either a string or an array of typed
        // parts. Narrow safely without `as any` so a malformed message
        // doesn't crash the response builder.
        const responseText: string | null = (() => {
            const c = lastMessage?.content;
            if (typeof c === 'string') return c;
            if (Array.isArray(c)) {
                const textPart = c.find(
                    (p): p is { type: 'text'; text: string } =>
                        typeof p === 'object' && p !== null && (p as { type?: unknown }).type === 'text'
                );
                return textPart?.text ?? null;
            }
            return null;
        })();

        logger.info({ duration, sessionId }, 'Vibe agent response completed');

        return c.json({
            success: true,
            response: responseText,
            duration,
            timestamp: new Date().toISOString(),
            sessionId,
        });
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Vibe agent error');

        return c.json({
            success: false,
            error: 'Failed to process vibe agent request',
            details: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});

app.post('/vibe/stream', zValidator('json', vibeSchema), async (c) => {
    try {
        const body = c.req.valid('json');
        const sessionId = body.session_id || 'default';
        const messages: ApiMessage[] = body.messages;

        logger.info({ sessionId }, 'Vibe agent streaming request received');

        // The harness owns the agent + backend for this session (built once,
        // then cached). The HTTP layer no longer caches agents or opens its
        // own SQLite connection.
        const session = await vibeRuntime.session(sessionId);
        const agent = session.raw;
        const sessionBackend = session.backend!;
        await applyModelOverride(agent, body.model);
        applySearchProvider(agent, body.search_provider);
        if (body.mode) agent.setMode(body.mode, 'user');

        // Pass originalMessages so AI SDK reuses message IDs when the client
        // resubmits after a tool approval. We detect that case either by the
        // last message being an assistant turn OR by it carrying any
        // tool-approval-response part (which is what addToolApprovalResponse
        // appends client-side).
        const lastMessage = messages[messages.length - 1];
        const lastParts = 'parts' in (lastMessage ?? {}) ? (lastMessage as { parts: Array<{ type: string }> }).parts : undefined;
        const hasApprovalResponse = Array.isArray(lastParts)
            && lastParts.some(p => p?.type === 'tool-approval-response');
        const originalMessages = (lastMessage?.role === 'assistant' || hasApprovalResponse)
            ? messages
            : undefined;

        // Build an AbortController for this stream. Unlike pre-resumable
        // PRs, we deliberately do NOT link this to `c.req.raw.signal`: a
        // client disconnect should leave the underlying loop running so a
        // reconnect can pick up via the live tail. Only an explicit
        // POST /sessions/:id/abort triggers cancellation.
        const streamController = new AbortController();
        streamCoordinator.registerStreamController(sessionId, streamController);

        // Provision a streamId + registry entry + SQLite stream row so
        // both the live-tail and replay paths agree on the same identity.
        const streamId = crypto.randomUUID();
        streamCoordinator.streamRegistry.create(streamId, sessionId);
        await sessionBackend.beginStream(streamId, sessionId);

        const onChunk = (chunk: unknown) => {
            const entry = streamCoordinator.streamRegistry.get(streamId);
            if (!entry) return;
            // Persist first, then fan out — so a reconnect that arrives
            // between persist and emit sees the chunk in SQLite and the
            // subscriber can dedupe by seq.
            entry.lastSeq += 1;
            const seq = entry.lastSeq;
            // Fire-and-forget: don't block fan-out on the DB write; seq ordering
            // is carried by `seq`, not insert order.
            sessionBackend.appendStreamChunk(streamId, seq, chunk)
                .catch(err => console.error('[vibe] appendStreamChunk failed:', err));
            for (const sub of entry.subscribers) {
                try { sub(seq, chunk); } catch (err) { console.error('[vibe] subscriber threw:', err); }
            }
        };

        const onStreamEnd = (status: 'completed' | 'failed') => {
            sessionBackend.endStream(streamId, status)
                .catch(err => console.error('[vibe] endStream failed:', err));
            streamCoordinator.streamRegistry.complete(streamId, status);
            streamCoordinator.clearStreamController(sessionId, streamController);
        };

        const response = await createAgentStreamResponse({
            agent,
            uiMessages: body.messages as unknown as Parameters<typeof createAgentStreamResponse>[0]['uiMessages'],
            originalMessages: originalMessages as unknown as Parameters<typeof createAgentStreamResponse>[0]['originalMessages'],
            backend: sessionBackend,
            abortSignal: streamController.signal,
            onChunk,
            onStreamEnd,
        });

        // Surface the streamId so the client can pass it back to the
        // reconnect endpoint after a network blip.
        const headers = new Headers(response.headers);
        headers.set('x-vibes-stream-id', streamId);
        headers.set('access-control-expose-headers', 'x-vibes-stream-id');
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });


    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Vibe agent streaming error');

        return c.json({
            success: false,
            error: 'Failed to stream vibe agent request',
        }, 500);
    }
});


/**
 * Reconnect to an in-flight stream. The client passes the streamId it
 * received via the `x-vibes-stream-id` header on the original POST plus
 * the last chunk_seq it actually processed (`fromSeq`). The endpoint
 * replays any persisted chunks past fromSeq, then — if the stream is
 * still active in the in-memory registry — subscribes to the live tail
 * and forwards new chunks until the stream ends.
 *
 * Returns 204 if the stream is unknown or its persisted log has aged
 * past the replay TTL.
 */
const RECONNECT_REPLAY_TTL_MS = 5 * 60 * 1000;

app.get('/vibe/:sessionId/stream', async (c) => {
    const sessionId = c.req.param('sessionId');
    const streamId = c.req.query('streamId');
    const fromSeqStr = c.req.query('fromSeq') ?? '0';
    const fromSeq = Math.max(0, Number.parseInt(fromSeqStr, 10) || 0);

    if (!streamId) {
        return c.json({ success: false, error: 'streamId query param required' }, 400);
    }

    const backend = await vibeRuntime.backend(sessionId);
    const meta = await backend.getStreamMeta(streamId);
    if (!meta || meta.sessionId !== sessionId) {
        return c.body(null, 204);
    }

    // Apply replay TTL to completed streams: long-since-finished streams
    // shouldn't be replayable indefinitely.
    if (meta.endedAt) {
        const endedAtMs = new Date(meta.endedAt).getTime();
        if (Date.now() - endedAtMs > RECONNECT_REPLAY_TTL_MS) {
            return c.body(null, 204);
        }
    }

    const registry = streamCoordinator.streamRegistry;
    const liveEntry = registry.get(streamId);

    // Pre-fetch persisted chunks here (async) so the sync ReadableStream
    // start() can enqueue them without awaiting.
    const persistedChunks = await backend.readStreamChunks(streamId, fromSeq);

    const stream = new ReadableStream<UIMessageChunk<unknown, never>>({
        start(controller) {
            // Phase 1: replay persisted chunks up to the current cursor.
            // We capture lastReplayedSeq so the live-tail subscriber can
            // dedupe any chunk that landed between read + emit.
            let lastReplayedSeq = fromSeq - 1;
            try {
                for (const row of persistedChunks) {
                    controller.enqueue(row.payload as UIMessageChunk<unknown, never>);
                    lastReplayedSeq = Math.max(lastReplayedSeq, row.chunkSeq);
                }
            } catch (err) {
                console.error('[vibe] replay failed:', err);
            }

            // Phase 2: if the stream has already ended, close after replay.
            if (!liveEntry || liveEntry.completed) {
                controller.close();
                return;
            }

            // Phase 3: subscribe to the live tail. Forward only chunks
            // whose seq is strictly greater than the highest replayed seq.
            const unsubscribe = registry.subscribe(
                streamId,
                (seq, chunk) => {
                    if (seq <= lastReplayedSeq) return;
                    try {
                        controller.enqueue(chunk as UIMessageChunk<unknown, never>);
                    } catch (err) {
                        console.error('[vibe] live forward failed:', err);
                    }
                },
                () => {
                    try { controller.close(); } catch { /* already closed */ }
                }
            );

            // Best-effort: tear down the subscriber if the client cancels
            // the response. Hono propagates this via the request signal.
            const clientSignal = c.req.raw.signal;
            const onAbort = () => {
                unsubscribe();
                try { controller.close(); } catch { /* already closed */ }
            };
            if (clientSignal.aborted) {
                onAbort();
            } else {
                clientSignal.addEventListener('abort', onAbort, { once: true });
            }
        },
    });

    return createUIMessageStreamResponse({
        stream,
        headers: {
            'X-Accel-Buffering': 'no',
            'x-vibes-stream-id': streamId,
        },
    });
});

/**
 * Session-keyed reconnect — what the AI SDK's `useChat().resumeStream()` calls
 * on wake/online. The client only knows the session id; we resolve its latest
 * stream, replay the persisted chunks (so the UI is rebuilt from where it left
 * off), and — if that run is still live in the registry — tail it to completion.
 * Returns 204 when there's nothing to resume (no stream, or it aged past the
 * replay TTL). UI message parts reconcile by id, so a full replay is safe.
 */
app.get('/vibe/:sessionId/reconnect', async (c) => {
    const sessionId = c.req.param('sessionId');
    const backend = await vibeRuntime.backend(sessionId);
    const latest = await backend.getLatestStream(sessionId);
    if (!latest) return c.body(null, 204);

    const streamId = latest.streamId;
    if (latest.endedAt) {
        const endedAtMs = new Date(latest.endedAt).getTime();
        if (Date.now() - endedAtMs > RECONNECT_REPLAY_TTL_MS) return c.body(null, 204);
    }

    const registry = streamCoordinator.streamRegistry;
    const liveEntry = registry.get(streamId);

    // Pre-fetch persisted chunks (async) for the sync start() below.
    const persistedChunks = await backend.readStreamChunks(streamId, 0);

    const stream = new ReadableStream<UIMessageChunk<unknown, never>>({
        start(controller) {
            let lastReplayedSeq = -1;
            try {
                for (const row of persistedChunks) {
                    controller.enqueue(row.payload as UIMessageChunk<unknown, never>);
                    lastReplayedSeq = Math.max(lastReplayedSeq, row.chunkSeq);
                }
            } catch (err) {
                console.error('[vibe] reconnect replay failed:', err);
            }

            if (!liveEntry || liveEntry.completed) {
                controller.close();
                return;
            }

            const unsubscribe = registry.subscribe(
                streamId,
                (seq, chunk) => {
                    if (seq <= lastReplayedSeq) return;
                    try {
                        controller.enqueue(chunk as UIMessageChunk<unknown, never>);
                    } catch (err) {
                        console.error('[vibe] reconnect live forward failed:', err);
                    }
                },
                () => {
                    try { controller.close(); } catch { /* already closed */ }
                },
            );

            const clientSignal = c.req.raw.signal;
            const onAbort = () => {
                unsubscribe();
                try { controller.close(); } catch { /* already closed */ }
            };
            if (clientSignal.aborted) onAbort();
            else clientSignal.addEventListener('abort', onAbort, { once: true });
        },
    });

    return createUIMessageStreamResponse({
        stream,
        headers: { 'X-Accel-Buffering': 'no', 'x-vibes-stream-id': streamId },
    });
});

/**
 * Direct, token-free workflow run (the slash-command / Run-button path). Runs
 * the WorkflowEngine for `:nameOrId` with the posted `inputs`, streaming live
 * `data-workflow` step parts + a canvas artifact + a text breadcrumb into the
 * session thread. Registered as a resumable stream so the client tails it via
 * `resumeStream()` (GET …/reconnect). No agent loop — deterministic + cheap.
 */
app.post('/vibe/:sessionId/workflows/:nameOrId/run', async (c) => {
    const sessionId = c.req.param('sessionId');
    const nameOrId = c.req.param('nameOrId');
    const body = await c.req.json().catch(() => ({} as any));
    const inputs: Record<string, unknown> = body?.inputs ?? {};

    const list = await readWorkflowsFile();
    const workflow = findWorkflow(list, nameOrId);
    if (!workflow) return c.json({ success: false, error: `No workflow "${nameOrId}".` }, 404);

    const missing = (workflow.inputs ?? [])
        .filter((i: any) => i.required && i.default === undefined && (inputs[i.name] === undefined || inputs[i.name] === null || inputs[i.name] === ''))
        .map((i: any) => i.name);
    if (missing.length) {
        return c.json({ success: false, error: `Missing required input(s): ${missing.join(', ')}.`, requiredInputs: workflow.inputs }, 400);
    }

    const modelId = typeof body?.model === 'string' && isKnownModelId(body.model) ? body.model : getDefaultModelId();
    const model = getModel({ provider: 'openrouter', id: modelId });

    const session = await vibeRuntime.session(sessionId);
    const backend = session.backend!;

    // Register a resumable stream so the client tails it via resumeStream().
    const streamId = crypto.randomUUID();
    streamCoordinator.streamRegistry.create(streamId, sessionId);
    await backend.beginStream(streamId, sessionId);

    const onChunk = (chunk: unknown) => {
        const entry = streamCoordinator.streamRegistry.get(streamId);
        if (!entry) return;
        entry.lastSeq += 1;
        const seq = entry.lastSeq;
        backend.appendStreamChunk(streamId, seq, chunk).catch((err: unknown) => console.error('[wf-run] appendStreamChunk failed:', err));
        for (const sub of entry.subscribers) { try { sub(seq, chunk); } catch (err) { console.error('[wf-run] subscriber threw:', err); } }
    };

    const stream = createUIMessageStream({
        async execute({ writer }) {
            const dsw = createDataStreamWriter(writer as any);
            const outcome = await runWorkflowToStream(workflow as any, {
                model,
                inputs,
                writer: dsw,
                workspaceDir: 'workspace',
                resolveWorkflow: (n) => findWorkflow(list, n) as any,
            });
            const summary = outcome.success
                ? `Ran workflow **${workflow.name}**` +
                  (outcome.outputPath ? ` → output saved to \`${outcome.outputPath}\`${outcome.rendered ? ' (rendered in the canvas)' : ''}` : '') +
                  (outcome.modelCalls != null ? ` · ${outcome.modelCalls} model call${outcome.modelCalls === 1 ? '' : 's'}` : '') + '.'
                : `Workflow **${workflow.name}** failed: ${outcome.error ?? 'unknown error'}`;
            const id = 'wf-breadcrumb';
            writer.write({ type: 'text-start', id } as any);
            writer.write({ type: 'text-delta', id, delta: summary } as any);
            writer.write({ type: 'text-end', id } as any);
        },
        async onFinish({ messages }) {
            try { await backend.setUIMessages(messages); } catch (err) { console.error('[wf-run] persist UI messages failed:', err); }
        },
    });

    // Drain the stream → persist + fan out to any live reconnect subscriber.
    void (async () => {
        const reader = (stream as unknown as ReadableStream<UIMessageChunk<unknown, never>>).getReader();
        let status: 'completed' | 'failed' = 'completed';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                onChunk(value);
            }
        } catch (err) {
            status = 'failed';
            console.error('[wf-run] run errored:', err);
        } finally {
            reader.releaseLock();
            await backend.endStream(streamId, status).catch(() => { /* ignore */ });
            streamCoordinator.streamRegistry.complete(streamId, status);
        }
    })();

    return c.json({ success: true, streamId });
});

app.post('/simple/stream', zValidator('json', vibeSchema), async (c) => {
    try {
        const body = c.req.valid('json');
        const messages: ApiMessage[] = body.messages;

        // Use custom stream response that integrates with middleware writers
        // This enables onData callbacks and custom data streaming
        const sessionBackend = await vibeRuntime.backend('default');
        return createAgentStreamResponse({
            agent: simpleAgent,
            uiMessages: messages as unknown as Parameters<typeof createAgentStreamResponse>[0]['uiMessages'],
            backend: sessionBackend,
        });

    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
        }, 'Simple agent streaming error');

        return c.json({
            success: false,
            error: 'Failed to stream simple agent request',
        }, 500);
    }
});

export default app;
