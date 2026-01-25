import { tool, UIMessageStreamWriter } from "ai";
import { AgentUIMessage, Middleware } from "../core/types";
import z from "zod";
import * as path from 'node:path';


interface SkillMetadata {
    name: string;
    description: string;
    path: string;
    instructions?: string;
}

/**
 * Middleware that implements an on-demand skill discovery system.
 * Skills are loaded from SKILL.md files in the skills/ directory.
 */
export default class SkillsMiddleware implements Middleware {
    name = 'SkillsMiddleware';
    private skills: Map<string, SkillMetadata> = new Map();
    private loadedSkills: Set<string> = new Set();
    private initializationPromise: Promise<void>;
    private writer?: UIMessageStreamWriter<AgentUIMessage>;

    constructor() {
        this.initializationPromise = this.init();
    }

    onStreamReady(writer: UIMessageStreamWriter<AgentUIMessage>) {
        this.writer = writer;
    }

    private async init() {
        const glob = new Bun.Glob("skills/*/SKILL.md");
        const root = process.cwd();

        for await (const relativePath of glob.scan(root)) {
            const skillMdPath = path.join(root, relativePath);
            const content = await Bun.file(skillMdPath).text();
            const metadata = this.parseSkillMd(content, skillMdPath);
            if (metadata) {
                this.skills.set(metadata.name, metadata);
            }
        }
    }

    private parseSkillMd(content: string, filePath: string): SkillMetadata | null {
        const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!frontmatterMatch) return null;

        const yaml = frontmatterMatch[1];
        const nameMatch = yaml.match(/^name:\s*(.*)$/m);
        const descMatch = yaml.match(/^description:\s*(.*)$/m);

        if (!nameMatch || !descMatch) return null;

        return {
            name: nameMatch[1].trim(),
            description: descMatch[1].trim(),
            path: filePath,
            instructions: content.slice(frontmatterMatch[0].length).trim()
        };
    }

    async waitReady() {
        await this.initializationPromise;
    }

    get tools() {
        return {
            load_skill: tool({
                description: 'Load detailed instructions and rules for a specific skill',
                inputSchema: z.object({
                    name: z.string().describe('The name of the skill to load'),
                }),
                execute: async ({ name }) => {
                    const skill = this.skills.get(name);
                    if (!skill) {
                        throw new Error(`Skill "${name}" not found.`);
                    }

                    this.writer?.write({
                        type: 'data-status',
                        data: { message: `Loading skill: ${name}...` },
                    });

                    this.loadedSkills.add(name);
                    return {
                        success: true,
                        message: `Skill "${name}" loaded. Detailed instructions are now available in your system prompt.`
                    };
                },
            }),
            list_skills: tool({
                description: 'List all available modular skills',
                inputSchema: z.object({}),
                execute: async () => {
                    return {
                        skills: Array.from(this.skills.values()).map(s => ({
                            name: s.name,
                            description: s.description,
                            loaded: this.loadedSkills.has(s.name)
                        }))
                    };
                }
            })
        };
    }

    modifySystemPrompt(prompt: string): string {
        const availableSkills = Array.from(this.skills.values())
            .map(s => `- ${s.name}: ${s.description}${this.loadedSkills.has(s.name) ? ' (LOADED)' : ''}`)
            .join('\n');

        let skillsPrompt = `${prompt}

## Modular Skills
You have access to a library of specialized skills. You only see their descriptions initially.
If a task requires specialized knowledge from a skill, use load_skill() to reveal its full instructions.

Available Skills:
${availableSkills || 'No skills found.'}
`;

        // Inject instructions for loaded skills
        this.loadedSkills.forEach(skillName => {
            const skill = this.skills.get(skillName);
            if (skill && skill.instructions) {
                skillsPrompt += `\n\n### Skill: ${skill.name}\n${skill.instructions}`;
            }
        });

        return skillsPrompt;
    }
}