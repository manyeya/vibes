import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Vibes' per-user home for all runtime state — SQLite DB, sessions, projects,
 * prompts. Override with `VIBES_HOME`; defaults to `~/.vibes`.
 *
 * This decouples state from the process cwd, so the `vibes` CLI can run inside
 * any repo without scattering a `workspace/` dir into it (or colliding across
 * repos). The project being worked on is a separate concept — an "open folder"
 * workspace rooted at the repo dir — not where Vibes keeps its own state.
 */
export const VIBES_HOME = process.env.VIBES_HOME?.trim()
  ? resolve(process.env.VIBES_HOME)
  : join(homedir(), '.vibes');

/** Absolute path under {@link VIBES_HOME}. */
export const homePath = (...segments: string[]): string => join(VIBES_HOME, ...segments);
