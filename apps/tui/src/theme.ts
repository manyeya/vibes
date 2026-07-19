// Theme registry. `theme` is a stable object everything imports and reads at
// render time; switching a theme mutates it in place and bumps a version that
// `useTheme()` subscribes to, so the whole tree repaints. Palettes are the
// Bearded Theme family (see themes.gen.ts), generated from BeardedBear's Zed
// build — no hand-typed colors.
import { RGBA, SyntaxStyle } from '@opentui/core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { useSyncExternalStore } from 'react';
import { THEMES, type Palette } from './themes.gen';

export { THEME_APPEARANCE, THEME_NAMES, type Palette } from './themes.gen';

const DEFAULT = 'Arc';
const CONFIG = join(homedir(), '.config', 'vibes', 'theme');

function load(): string {
  try {
    const n = readFileSync(CONFIG, 'utf8').trim();
    if (THEMES[n]) return n;
  } catch {
    /* first run / unreadable — fall through to default */
  }
  return DEFAULT;
}

let activeName = load();

// Stable reference: components import `theme` and read `theme.x` inline in JSX,
// so mutating the fields + forcing a re-render recolors everything.
export const theme: Palette = { ...THEMES[activeName]! };

export const activeTheme = () => activeName;

const listeners = new Set<() => void>();
let version = 0;

/** Apply a theme. `persist: false` is for live preview (no disk write). */
export function applyTheme(name: string, persist = true) {
  const next = THEMES[name];
  if (!next) return;
  activeName = name;
  Object.assign(theme, next);
  syntaxStyle = buildSyntax();
  version++;
  if (persist) {
    try {
      mkdirSync(dirname(CONFIG), { recursive: true });
      writeFileSync(CONFIG, name);
    } catch {
      /* config dir not writable — the choice just won't survive restart */
    }
  }
  for (const l of listeners) l();
}

/** Subscribe a component to theme changes; returns the active theme name. */
export function useTheme(): string {
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => version,
    () => version,
  );
  return activeName;
}

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const fmtElapsed = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
export const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// Context-window fullness color: calm (muted) while there's room, warns as it
// fills. Glanceable — the color does the reading so you don't have to.
export const ctxColor = (pct: number) => (pct >= 85 ? theme.error : pct >= 65 ? theme.warning : theme.textMuted);

// Markdown/code styling, driven entirely by the active palette so it recolors
// with the theme. Rebuilt on switch; exported as a live binding importers read.
function buildSyntax(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromHex(theme.text) },
    'markup.heading': { fg: RGBA.fromHex(theme.accent), bold: true },
    'markup.heading.1': { fg: RGBA.fromHex(theme.accent), bold: true, underline: true },
    'markup.heading.2': { fg: RGBA.fromHex(theme.accent), bold: true },
    'markup.heading.3': { fg: RGBA.fromHex(theme.accent), bold: true },
    'markup.bold': { fg: RGBA.fromHex(theme.warning), bold: true },
    'markup.strong': { fg: RGBA.fromHex(theme.warning), bold: true },
    'markup.italic': { fg: RGBA.fromHex(theme.yellow), italic: true },
    'markup.list': { fg: RGBA.fromHex(theme.primary) },
    'markup.quote': { fg: RGBA.fromHex(theme.yellow), italic: true },
    'markup.raw': { fg: RGBA.fromHex(theme.green) },
    'markup.raw.block': { fg: RGBA.fromHex(theme.green) },
    'markup.raw.inline': { fg: RGBA.fromHex(theme.green), bg: RGBA.fromHex(theme.background) },
    'markup.link': { fg: RGBA.fromHex(theme.primary), underline: true },
    'markup.link.label': { fg: RGBA.fromHex(theme.info), underline: true },
    'markup.link.url': { fg: RGBA.fromHex(theme.primary), underline: true },
    comment: { fg: RGBA.fromHex(theme.textMuted), italic: true },
    string: { fg: RGBA.fromHex(theme.green) },
    number: { fg: RGBA.fromHex(theme.warning) },
    boolean: { fg: RGBA.fromHex(theme.warning) },
    keyword: { fg: RGBA.fromHex(theme.accent) },
    function: { fg: RGBA.fromHex(theme.primary) },
    'function.method': { fg: RGBA.fromHex(theme.primary) },
    variable: { fg: RGBA.fromHex(theme.error) },
    type: { fg: RGBA.fromHex(theme.yellow) },
    operator: { fg: RGBA.fromHex(theme.info) },
    punctuation: { fg: RGBA.fromHex(theme.text) },
  });
}

export let syntaxStyle = buildSyntax();
