import React, { useEffect, useMemo, useState } from 'react';
import { WorkflowRunForm, type RunnableWorkflow } from './WorkflowRunForm';

/** Actions a command can take when selected from the palette. */
export interface PaletteCtx {
    openForm: (form: React.ReactNode) => void;
    closeForm: () => void;
    sendUserMessage: (text: string) => void;
    insertText: (text: string) => void;
    runWorkflow: (nameOrId: string, inputs: Record<string, unknown>) => void;
}

export interface Command {
    id: string;
    kind: 'workflow' | 'agent' | 'skill' | 'prompt';
    label: string;
    description?: string;
    keywords?: string[];
    /** Slug/aliases for inline invocation (`/slug …`). */
    slug?: string;
    run: (ctx: PaletteCtx) => void;
}

function useJson<T>(url: string, pick: (data: any) => T, deps: unknown[] = []): T | null {
    const [val, setVal] = useState<T | null>(null);
    useEffect(() => {
        let live = true;
        fetch(url)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d) setVal(pick(d)); })
            .catch(() => { /* provider just contributes nothing */ });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return val;
}

/** Workflows → open the typed run form → run via the direct endpoint. */
export function useWorkflowCommands(): Command[] {
    const workflows = useJson<RunnableWorkflow[]>('/api/workflows', (d) => d.workflows ?? []);
    return useMemo(
        () =>
            (workflows ?? []).map((w) => ({
                id: `wf:${w.id}`,
                kind: 'workflow' as const,
                label: w.name,
                description: w.description,
                slug: (w as { slug?: string }).slug,
                keywords: [w.name, (w as { slug?: string }).slug ?? '', ...(w.inputs ?? []).map((i) => i.name)],
                run: (ctx) =>
                    ctx.openForm(
                        <WorkflowRunForm
                            workflow={w}
                            onSubmit={(inputs) => ctx.runWorkflow(w.name, inputs)}
                            onCancel={ctx.closeForm}
                        />,
                    ),
            })),
        [workflows],
    );
}

/** Sub-agents → seed the composer with a delegation prefix (agent-mediated). */
export function useAgentCommands(): Command[] {
    const agents = useJson<Array<{ name: string; description?: string }>>('/api/agents', (d) => d.agents ?? []);
    return useMemo(
        () =>
            (agents ?? []).map((a) => ({
                id: `agent:${a.name}`,
                kind: 'agent' as const,
                label: a.name,
                description: a.description,
                keywords: [a.name],
                run: (ctx) => ctx.insertText(`Delegate this to the ${a.name} sub-agent: `),
            })),
        [agents],
    );
}

/** Skills → seed the composer with a use-skill prefix (agent-mediated). */
export function useSkillCommands(): Command[] {
    const skills = useJson<Array<{ name: string; description?: string }>>('/api/skills', (d) => d.skills ?? []);
    return useMemo(
        () =>
            (skills ?? []).map((s) => ({
                id: `skill:${s.name}`,
                kind: 'skill' as const,
                label: s.name,
                description: s.description,
                keywords: [s.name],
                run: (ctx) => ctx.insertText(`Use the "${s.name}" skill to: `),
            })),
        [skills],
    );
}

/** Saved prompts → insert the prompt body into the composer. */
export function usePromptCommands(): Command[] {
    const prompts = useJson<Array<{ id: string; name: string; body: string }>>('/api/prompts', (d) => d.prompts ?? []);
    return useMemo(
        () =>
            (prompts ?? []).map((p) => ({
                id: `prompt:${p.id}`,
                kind: 'prompt' as const,
                label: p.name,
                description: p.body.slice(0, 80),
                keywords: [p.name],
                run: (ctx) => ctx.insertText(p.body),
            })),
        [prompts],
    );
}

/** All providers merged — the palette is provider-agnostic. */
export function useCommands(): Command[] {
    const workflows = useWorkflowCommands();
    const agents = useAgentCommands();
    const skills = useSkillCommands();
    const prompts = usePromptCommands();
    return useMemo(() => [...workflows, ...agents, ...skills, ...prompts], [workflows, agents, skills, prompts]);
}
