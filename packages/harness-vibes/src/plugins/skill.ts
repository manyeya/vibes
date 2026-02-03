import { tool, UIMessageStreamWriter } from "ai";
import { VibesUIMessage, Plugin } from "../core/types";
import z from "zod";
import * as path from "path";


interface SkillMetadata {
    name: string;
    description: string;
    path: string;
    instructions?: string;
    skillDir: string;
    keywords?: string[];
}

/**
 * Middleware that implements an on-demand skill activation system.
 * Skills are loaded from SKILL.md files in the skills/ directory.
 *
 * Usage: "activate <skill-name>" or "use <skill-name> skill"
 *
 * Supports Obsidian-style file includes: ![[path/to/file.md]]
 */
export default class SkillsPlugin implements Plugin {
    name = 'SkillsPlugin';
    private skills: Map<string, SkillMetadata> = new Map();
    private activeSkills: Set<string> = new Set();
    private initializationPromise: Promise<void>;
    private writer?: UIMessageStreamWriter<VibesUIMessage>;
    private includeCache: Map<string, string> = new Map();

    constructor() {
        this.initializationPromise = this.init();
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.writer = writer;
    }

    private async init() {
        const glob = new Bun.Glob("skills/*/SKILL.md");
        const root = process.cwd();

        for await (const relativePath of glob.scan(root)) {
            const skillMdPath = path.join(root, relativePath);
            const content = await Bun.file(skillMdPath).text();
            const skillDir = path.dirname(skillMdPath);
            const metadata = this.parseSkillMd(content, skillMdPath, skillDir);
            if (metadata) {
                this.skills.set(metadata.name, metadata);
            }
        }
    }

    private parseSkillMd(content: string, filePath: string, skillDir: string): SkillMetadata | null {
        const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!frontmatterMatch) return null;

        const yaml = frontmatterMatch[1];
        const nameMatch = yaml.match(/^name:\s*(.*)$/m);
        const descMatch = yaml.match(/^description:\s*(.*)$/m);
        const keywordsMatch = yaml.match(/^keywords:\s*\[(.*?)\]$/m);

        if (!nameMatch || !descMatch) return null;

        return {
            name: nameMatch[1].trim(),
            description: descMatch[1].trim(),
            path: filePath,
            skillDir,
            keywords: keywordsMatch ? keywordsMatch[1].split(',').map(k => k.trim()) : [],
            instructions: content.slice(frontmatterMatch[0].length).trim()
        };
    }

    /**
     * Process Obsidian-style includes: ![[path/to/file.md]]
     * Recursively inlines referenced files with cycle detection.
     */
    private async processIncludes(
        content: string,
        skillDir: string,
        visited: Set<string> = new Set(),
        depth: number = 0
    ): Promise<string> {
        const MAX_DEPTH = 10;
        if (depth > MAX_DEPTH) {
            return content; // Prevent infinite recursion
        }

        // Match ![[path]] or ![[path|title]]
        const includeRegex = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

        const processMatch = async (_match: string, filePath: string, _title?: string): Promise<string> => {
            const fullPath = path.resolve(skillDir, filePath);

            // Cycle detection
            if (visited.has(fullPath)) {
                return `<!-- [CYCLE: Already included ${filePath}] -->`;
            }

            // Check cache first
            if (this.includeCache.has(fullPath)) {
                return this.includeCache.get(fullPath)!;
            }

            try {
                const fileContent = await Bun.file(fullPath).text();
                const newVisited = new Set(visited);
                newVisited.add(fullPath);

                // Recursively process includes in the included file
                const processedContent = await this.processIncludes(fileContent, path.dirname(fullPath), newVisited, depth + 1);

                // Cache the result
                this.includeCache.set(fullPath, processedContent);

                return processedContent;
            } catch (error) {
                return `<!-- [ERROR: Could not include ${filePath}: ${(error as Error).message}] -->`;
            }
        };

        // Process all includes (sequentially to handle async)
        let result = content;
        const matches = Array.from(content.matchAll(includeRegex));

        for (const match of matches) {
            const [fullMatch, filePath, title] = match;
            const replacement = await processMatch(fullMatch, filePath, title);
            result = result.replace(fullMatch, replacement);
        }

        return result;
    }

    async waitReady() {
        await this.initializationPromise;
    }

    /**
     * Find a skill by name or keyword/alias
     */
    private findSkill(query: string): SkillMetadata | undefined {
        const normalizedQuery = query.toLowerCase().trim();

        // Direct name match
        for (const [name, skill] of this.skills) {
            if (name.toLowerCase() === normalizedQuery) {
                return skill;
            }
        }

        // Partial name or keyword match
        for (const [name, skill] of this.skills) {
            if (name.toLowerCase().includes(normalizedQuery) || normalizedQuery.includes(name.toLowerCase())) {
                return skill;
            }
            if (skill.keywords?.some(k => k.toLowerCase() === normalizedQuery)) {
                return skill;
            }
        }

        return undefined;
    }

    /**
     * Activate a skill and return its processed content
     */
    async activateSkill(name: string): Promise<{ content: string; skill: SkillMetadata }> {
        const skill = this.findSkill(name);
        if (!skill) {
            const available = Array.from(this.skills.keys()).sort().join(', ');
            throw new Error(`Skill "${name}" not found. Available skills: ${available}`);
        }

        this.activeSkills.add(skill.name);

        let instructions = skill.instructions || '';
        if (instructions) {
            instructions = await this.processIncludes(instructions, skill.skillDir);
        }

        return { content: instructions, skill };
    }

    /**
     * Deactivate a skill
     */
    deactivateSkill(name: string): boolean {
        const skill = this.findSkill(name);
        if (skill) {
            this.activeSkills.delete(skill.name);
            return true;
        }
        return false;
    }

    get tools() {
        return {
            activate_skill: tool({
                description: 'Activate a skill to load its instructions into context. Use this when the user asks to "activate" or "use" a specific skill.',
                inputSchema: z.object({
                    name: z.string().describe('The name or keyword of the skill to activate (e.g., "frontend", "backend", "testing")'),
                }),
                execute: async ({ name }) => {
                    try {
                        const { skill } = await this.activateSkill(name);

                        this.writer?.write({
                            type: 'data-status',
                            data: { message: `✓ Activated skill: ${skill.name}` },
                        });

                        return {
                            success: true,
                            skill: skill.name,
                            message: `Skill "${skill.name}" has been activated. Its instructions are now part of your system prompt.`
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: (error as Error).message
                        };
                    }
                },
            }),
            deactivate_skill: tool({
                description: 'Deactivate an active skill to remove its instructions from context',
                inputSchema: z.object({
                    name: z.string().describe('The name of the skill to deactivate'),
                }),
                execute: async ({ name }) => {
                    const deactivated = this.deactivateSkill(name);
                    if (deactivated) {
                        return {
                            success: true,
                            message: `Skill "${name}" has been deactivated.`
                        };
                    }
                    return {
                        success: false,
                        error: `Skill "${name}" not found or was not active.`
                    };
                },
            }),
            list_skills: tool({
                description: 'List all available skills with their descriptions and active status',
                inputSchema: z.object({}),
                execute: async () => {
                    return {
                        skills: Array.from(this.skills.values()).map(s => ({
                            name: s.name,
                            description: s.description,
                            active: this.activeSkills.has(s.name),
                            keywords: s.keywords
                        }))
                    };
                }
            })
        };
    }

    async modifySystemPrompt(prompt: string): Promise<string> {
        if (this.activeSkills.size === 0) {
            // No active skills - just mention availability briefly
            const skillNames = Array.from(this.skills.keys()).sort();
            return `${prompt}

## Skills System
You have access to optional skill modules. Available skills: ${skillNames.join(', ')}.
When a user asks to "activate [skill]" or "use [skill]", use the activate_skill tool.
`;
        }

        // Build prompt with active skill instructions
        let skillsPrompt = `${prompt}

---

## Active Skills
The following skills are currently active:

`;

        for (const skillName of this.activeSkills) {
            const skill = this.skills.get(skillName);
            if (skill) {
                let instructions = skill.instructions || '';
                if (instructions) {
                    instructions = await this.processIncludes(instructions, skill.skillDir);
                }
                skillsPrompt += `### ${skill.name}\n\n`;
                if (skill.description) {
                    skillsPrompt += `${skill.description}\n\n`;
                }
                if (instructions) {
                    skillsPrompt += `${instructions}\n\n`;
                }
            }
        }

        return skillsPrompt;
    }
}