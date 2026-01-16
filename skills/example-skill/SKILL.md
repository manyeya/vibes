---
name: example-skill
description: Example skill demonstrating proper Anthropic SKILL.md format with YAML frontmatter
---

# Example Skill

This skill demonstrates the correct format for Anthropic skills with YAML frontmatter.

## Quick Start

This is a placeholder skill showing proper structure. Replace this content with your specific skill instructions.

## Format Guidelines

Skills use YAML frontmatter with `name` and `description` fields:

- `name`: The skill identifier (must match folder name)
- `description`: What the skill does and when to use it

These are the only fields Claude reads to determine when to use the skill.

## When to Use

Use this skill as a template when creating new skills for the Vibes agent.

## Best Practices

1. Keep SKILL.md concise (under 500 lines)
2. Include detailed information in `references/` directory if needed
3. Add executable scripts to `scripts/` directory
4. Store assets (templates, images) in `assets/` directory
5. Follow progressive disclosure - only load what's needed

## References

For more information, see:
- [Anthropic Skills Repository](https://github.com/anthropics/skills)
- [SKILL.md Format Guide](https://www.claudeskill.site/en/blog/skill-md-format-en)
