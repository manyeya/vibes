export type AppAction = 'models' | 'themes' | 'sessions' | 'new' | 'help' | 'rewind';

export interface SlashCommand {
  name: string;
  desc: string;
  action: AppAction | 'artifacts';
}

export const COMMANDS: SlashCommand[] = [
  { name: 'model', desc: 'switch model', action: 'models' },
  { name: 'theme', desc: 'switch color theme', action: 'themes' },
  { name: 'sessions', desc: 'open session list', action: 'sessions' },
  { name: 'rewind', desc: 'restore files + conversation to an earlier turn', action: 'rewind' },
  { name: 'new', desc: 'new session', action: 'new' },
  { name: 'artifacts', desc: 'view artifacts', action: 'artifacts' },
  { name: 'help', desc: 'keys & commands', action: 'help' },
];

/** null = not a command; 'unknown' = starts with '/' but matches nothing. */
export function parseCommand(text: string): SlashCommand | 'unknown' | null {
  const word = text.trim().split(/\s+/)[0] ?? '';
  if (!word.startsWith('/')) return null;
  return COMMANDS.find((c) => `/${c.name}` === word) ?? 'unknown';
}

/** Prefix matches for the composer suggestion row ('/m' → [model]). */
export function matchCommands(draft: string): SlashCommand[] {
  const word = draft.trimStart().split(/\s+/)[0] ?? '';
  if (!word.startsWith('/')) return [];
  return COMMANDS.filter((c) => `/${c.name}`.startsWith(word));
}
