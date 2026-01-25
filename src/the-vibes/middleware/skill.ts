import { tool, UIMessageStreamWriter } from "ai";
import { AgentUIMessage, Middleware } from "../core/types";
import z from "zod";
import * as path from "path";


interface SkillMetadata {
    name: string;
    description: string;
    path: string;
    instructions?: string;
    skillDir: string;
}

/**
 * Middleware that implements an on-demand skill discovery system.
 * Skills are loaded from SKILL.md files in the skills/ directory.
 *
 * Supports Obsidian-style file includes: ![[path/to/file.md]]
 */
export default class SkillsMiddleware implements Middleware {
    name = 'SkillsMiddleware';
    private skills: Map<string, SkillMetadata> = new Map();
    private loadedSkills: Set<string> = new Set();
    private initializationPromise: Promise<void>;
    private writer?: UIMessageStreamWriter<AgentUIMessage>;
    private includeCache: Map<string, string> = new Map();

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

        if (!nameMatch || !descMatch) return null;

        return {
            name: nameMatch[1].trim(),
            description: descMatch[1].trim(),
            path: filePath,
            skillDir,
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

    async modifySystemPrompt(prompt: string): Promise<string> {
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

        // Inject instructions for loaded skills with includes processed
        for (const skillName of this.loadedSkills) {
            const skill = this.skills.get(skillName);
            if (skill && skill.instructions) {
                // Process ![[includes]] in the skill content
                const processedInstructions = await this.processIncludes(skill.instructions, skill.skillDir);
                skillsPrompt += `\n\n### Skill: ${skill.name}\n${processedInstructions}`;
            }
        }

        return skillsPrompt;
    }
}