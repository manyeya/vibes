// Tiny persisted-preferences store (~/.config/vibes/<name>). Used for the
// selected model, so a pick survives reloads instead of snapping back to the
// server default. Mirrors how theme.ts persists the active theme.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const path = (name: string) => join(homedir(), '.config', 'vibes', name);

export function loadPref(name: string): string | undefined {
  try {
    return readFileSync(path(name), 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

export function savePref(name: string, value: string): void {
  try {
    mkdirSync(dirname(path(name)), { recursive: true });
    writeFileSync(path(name), value);
  } catch {
    /* config dir not writable — the pick just won't survive restart */
  }
}
