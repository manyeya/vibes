import * as fs from "fs/promises";
import * as path from "path";
import {
    experimental_createSkillTool as createSkillTool,
    type SkillToolkit,
} from "bash-tool";
import { Plugin } from "../core/types";

export interface SkillsPluginConfig {
    /** Directory of skill subfolders (each with a SKILL.md). Defaults to $SKILLS_DIR or ./skills. */
    skillsDir?: string;
    /** Workspace the skill files are copied into, so their scripts/assets are reachable from bash. */
    workspaceDir?: string;
}

/**
 * Skills via Vercel Labs' `bash-tool`. It discovers skill folders (a SKILL.md
 * plus optional scripts/assets), exposes a `skill` tool that loads a skill's
 * instructions on demand, and drops the skill files into the workspace so the
 * agent can read their references and run their scripts through `bash`.
 *
 * This replaces the old Bun.Glob/Bun.file loader — discovery is now Node-clean —
 * and fits the full-bash model: a skill's scripts are just files in the
 * workspace the shell can execute.
 */
export default class SkillsPlugin implements Plugin {
    name = 'SkillsPlugin';
    private readonly skillsDir: string;
    private readonly workspaceDir: string;
    private skillTool?: SkillToolkit['skill'];
    private instructions = '';
    private ready?: Promise<void>;

    constructor(config: SkillsPluginConfig = {}) {
        this.skillsDir = path.resolve(
            process.cwd(),
            config.skillsDir ?? process.env.SKILLS_DIR ?? 'skills',
        );
        this.workspaceDir = config.workspaceDir ?? path.resolve(process.cwd(), 'workspace');
    }

    async waitReady(): Promise<void> {
        if (!this.ready) this.ready = this.load();
        await this.ready;
    }

    private async load(): Promise<void> {
        // No skills directory → the plugin simply contributes nothing.
        try {
            if (!(await fs.stat(this.skillsDir)).isDirectory()) return;
        } catch {
            return;
        }

        let toolkit: SkillToolkit;
        try {
            toolkit = await createSkillTool({ skillsDirectory: this.skillsDir, destination: 'skills' });
        } catch (err) {
            console.error('[SkillsPlugin] skill discovery failed:', err);
            return;
        }
        if (toolkit.skills.length === 0) return;

        // Copy the skill files into the workspace so bash (rooted there) can
        // read their references and run their scripts — the bash-tool model.
        await Promise.all(
            Object.entries(toolkit.files).map(async ([rel, content]) => {
                const dest = path.resolve(this.workspaceDir, rel.replace(/^\.\//, ''));
                await fs.mkdir(path.dirname(dest), { recursive: true });
                await fs.writeFile(dest, content, 'utf8');
            }),
        );

        this.skillTool = toolkit.skill;
        this.instructions = toolkit.instructions;
    }

    get tools(): Record<string, any> {
        return this.skillTool ? { skill: this.skillTool } : {};
    }

    modifySystemPrompt(prompt: string): string {
        if (!this.skillTool) return prompt;
        return `${prompt}

## Skills
Reusable capabilities live under \`./skills/\` in your workspace. Call the
\`skill("<name>")\` tool to load a skill's instructions before using it, then
follow them as authoritative — its scripts and assets are already in the
workspace, readable and runnable via bash.

${this.instructions}`;
    }
}
