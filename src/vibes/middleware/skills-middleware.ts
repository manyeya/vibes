import { z } from "zod";
import { context, createMiddleware, tool } from "langchain";
import fs from "fs/promises";
import path from "path";

const SKILLS_DIR = process.env.SKILLS_DIR || './skills';

const parseSkillFrontmatter = (content: string): { name: string; description: string; body: string } | null => {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/s);

  if (!frontmatterMatch) {
    return null;
  }

  const frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  const nameMatch = frontmatter.match(/^name:\s*(.+?)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+?)$/m);

  if (!nameMatch) {
    return null;
  }

  return {
    name: nameMatch[1].trim(),
    description: descMatch ? descMatch[1].trim() : 'No description provided',
    body,
  };
};

const loadSkillsFromDirectory = async (): Promise<any[]> => {
  try {
    const skillsDir = path.resolve(SKILLS_DIR);

    try {
      await fs.access(skillsDir);
    } catch {
      return [];
    }

    const skillFolders = await fs.readdir(skillsDir);
    const skills: any[] = [];

    for (const folder of skillFolders) {
      const skillPath = path.join(skillsDir, folder);
      const stat = await fs.stat(skillPath);

      if (stat.isDirectory()) {
        const skillFile = path.join(skillPath, 'SKILL.md');

        try {
          await fs.access(skillFile);
          const content = await fs.readFile(skillFile, 'utf-8');

          const parsed = parseSkillFrontmatter(content);

          if (parsed) {
            skills.push({
              name: parsed.name,
              description: parsed.description,
              content: parsed.body,
            });
          } else {
            console.error(`Failed to parse frontmatter from ${skillPath}`);
          }
        } catch (error) {
          console.error(`Failed to load skill from ${skillPath}:`, error);
        }
      }
    }

    return skills;
  } catch (error) {
    console.error(`Failed to load skills from ${SKILLS_DIR}:`, error);
    return [];
  }
};

const loadSkill = tool(
  async ({ skillName }) => {
    const skills = await loadSkillsFromDirectory();
    const skill = skills.find((s) => s.name === skillName);

    if (skill) {
      return `Loaded skill: ${skillName}\n\n${skill.content}`;
    }

    const available = skills.map((s) => s.name).join(", ");
    return `Skill '${skillName}' not found. Available skills: ${available}`;
  },
  {
    name: "load_skill",
    description: "Load full content of a skill from filesystem file",
    schema: z.object({
      skillName: z.string().describe("The name of the skill to load"),
    }),
  }
);

export const skillMiddleware = createMiddleware({
  name: "skillMiddleware",
  tools: [loadSkill],
  wrapModelCall: async (request, handler) => {
    try {
      const skills = await loadSkillsFromDirectory();
      const skillsPrompt = skills
        .map((skill) => `- **${skill.name}**: ${skill.description}`)
        .join("\n");

      const skillsAddendum =
        `\n\n## Available Skills\n\n${skillsPrompt}\n\n` +
        "Use the load_skill tool when you need detailed information " +
        "about handling a specific type of request.";

      const newSystemPrompt = request.systemPrompt + skillsAddendum;

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
