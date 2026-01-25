import { z } from "zod";
import { createMiddleware, tool } from "langchain";
import fs from "fs/promises";
import path from "path";

const SKILLS_DIR = process.env.SKILLS_DIR || './skills';

interface SkillMetadata {
  name: string;
  description: string;
  content: string;
  keywords?: string[];
  path: string;
}

class SkillsCache {
  private skills: Map<string, SkillMetadata> = new Map();
  private activeSkills: Set<string> = new Set();
  private initialized = false;

  async init() {
    if (this.initialized) return;

    try {
      const skillsDir = path.resolve(SKILLS_DIR);

      try {
        await fs.access(skillsDir);
      } catch {
        this.initialized = true;
        return;
      }

      const skillFolders = await fs.readdir(skillsDir);

      for (const folder of skillFolders) {
        const skillPath = path.join(skillsDir, folder);
        const stat = await fs.stat(skillPath);

        if (stat.isDirectory()) {
          const skillFile = path.join(skillPath, 'SKILL.md');

          try {
            await fs.access(skillFile);
            const content = await fs.readFile(skillFile, 'utf-8');
            const parsed = this.parseSkillFrontmatter(content);

            if (parsed) {
              this.skills.set(parsed.name, {
                name: parsed.name,
                description: parsed.description,
                content: parsed.body,
                keywords: parsed.keywords,
                path: skillPath,
              });
            }
          } catch (error) {
            console.error(`Failed to load skill from ${skillPath}:`, error);
          }
        }
      }

      this.initialized = true;
    } catch (error) {
      console.error(`Failed to load skills from ${SKILLS_DIR}:`, error);
      this.initialized = true;
    }
  }

  parseSkillFrontmatter(content: string): { name: string; description: string; body: string; keywords?: string[] } | null {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/s);

    if (!frontmatterMatch) {
      return null;
    }

    const frontmatter = frontmatterMatch[1];
    const body = frontmatterMatch[2];

    const nameMatch = frontmatter.match(/^name:\s*(.+?)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+?)$/m);
    const keywordsMatch = frontmatter.match(/^keywords:\s*\[(.*?)\]$/m);

    if (!nameMatch) {
      return null;
    }

    return {
      name: nameMatch[1].trim(),
      description: descMatch ? descMatch[1].trim() : 'No description provided',
      body,
      keywords: keywordsMatch ? keywordsMatch[1].split(',').map(k => k.trim()) : [],
    };
  }

  findSkill(query: string): SkillMetadata | undefined {
    const normalizedQuery = query.toLowerCase().trim();

    // Direct name match
    for (const skill of this.skills.values()) {
      if (skill.name.toLowerCase() === normalizedQuery) {
        return skill;
      }
    }

    // Partial name or keyword match
    for (const skill of this.skills.values()) {
      if (skill.name.toLowerCase().includes(normalizedQuery) || normalizedQuery.includes(skill.name.toLowerCase())) {
        return skill;
      }
      if (skill.keywords?.some(k => k.toLowerCase() === normalizedQuery)) {
        return skill;
      }
    }

    return undefined;
  }

  activateSkill(name: string): { success: boolean; message: string; skill?: SkillMetadata } {
    const skill = this.findSkill(name);

    if (!skill) {
      const available = Array.from(this.skills.keys()).sort().join(', ');
      return {
        success: false,
        message: `Skill "${name}" not found. Available skills: ${available}`
      };
    }

    this.activeSkills.add(skill.name);
    return {
      success: true,
      message: `Activated skill: ${skill.name}`,
      skill
    };
  }

  deactivateSkill(name: string): { success: boolean; message: string } {
    const skill = this.findSkill(name);

    if (!skill) {
      return { success: false, message: `Skill "${name}" not found.` };
    }

    if (this.activeSkills.has(skill.name)) {
      this.activeSkills.delete(skill.name);
      return { success: true, message: `Deactivated skill: ${skill.name}` };
    }

    return { success: false, message: `Skill "${name}" was not active.` };
  }

  listSkills() {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name,
      description: s.description,
      active: this.activeSkills.has(s.name),
      keywords: s.keywords,
    }));
  }

  getActiveSkillNames(): string[] {
    return Array.from(this.activeSkills);
  }

  getActiveSkillContent(skillName: string): string | undefined {
    const skill = this.skills.get(skillName);
    return skill?.content;
  }

  getAllSkillNames(): string[] {
    return Array.from(this.skills.keys()).sort();
  }
}

const cache = new SkillsCache();
cache.init();

const activateSkill = tool(
  async ({ name }) => {
    await cache.init();
    const result = cache.activateSkill(name);

    if (result.success && result.skill) {
      return `✓ ${result.message}\n\nThe skill instructions are now part of your system prompt.`;
    }

    return result.message;
  },
  {
    name: "activate_skill",
    description: "Activate a skill to load its instructions into context. Use when the user asks to 'activate' or 'use' a specific skill.",
    schema: z.object({
      name: z.string().describe("The name or keyword of the skill to activate (e.g., 'frontend', 'backend', 'testing')"),
    }),
  }
);

const deactivateSkill = tool(
  async ({ name }) => {
    await cache.init();
    const result = cache.deactivateSkill(name);
    return result.message;
  },
  {
    name: "deactivate_skill",
    description: "Deactivate an active skill to remove its instructions from context",
    schema: z.object({
      name: z.string().describe("The name of the skill to deactivate"),
    }),
  }
);

const listSkills = tool(
  async () => {
    await cache.init();
    const skills = cache.listSkills();

    return {
      skills: skills.map(s => ({
        name: s.name,
        description: s.description,
        active: s.active,
        keywords: s.keywords,
      }))
    };
  },
  {
    name: "list_skills",
    description: "List all available skills with their descriptions and active status",
    schema: z.object({}),
  }
);

export const skillMiddleware = createMiddleware({
  name: "skillMiddleware",
  tools: [activateSkill, deactivateSkill, listSkills],
  wrapModelCall: async (request, handler) => {
    try {
      await cache.init();
      const activeSkillNames = cache.getActiveSkillNames();

      // No active skills - just show available skills briefly
      if (activeSkillNames.length === 0) {
        const allSkillNames = cache.getAllSkillNames();
        const skillsAddendum =
          `\n\n## Skills System\n\n` +
          `You have access to optional skill modules. Available skills: ${allSkillNames.join(', ')}.\n` +
          `When a user asks to "activate [skill]" or "use [skill]", use the activate_skill tool.`;

        const newSystemPrompt = request.systemPrompt + skillsAddendum;
        return handler({
          ...request,
          systemPrompt: newSystemPrompt,
        });
      }

      // Build prompt with active skill content
      let skillsPrompt = `\n\n---\n\n## Active Skills\n\nThe following skills are currently active:\n\n`;

      for (const skillName of activeSkillNames) {
        const content = cache.getActiveSkillContent(skillName);
        const skill = cache.listSkills().find(s => s.name === skillName);

        if (skill) {
          skillsPrompt += `### ${skill.name}\n\n${skill.description}\n\n`;
          if (content) {
            skillsPrompt += `${content}\n\n`;
          }
        }
      }

      const newSystemPrompt = request.systemPrompt + skillsPrompt;

      return handler({
        ...request,
        systemPrompt: newSystemPrompt,
      });
    } catch (error) {
      console.error("Error in skillMiddleware:", error);
      return handler(request);
    }
  },
});
