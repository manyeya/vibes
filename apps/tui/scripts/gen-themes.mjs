#!/usr/bin/env node
// Regenerate src/themes.gen.ts from BeardedBear/bearded-theme (MIT).
// Self-contained: shallow-clones the repo to a temp dir and reads its Zed build
// (dist/zed/themes/bearded-theme.json — all variants in one file, with clean
// semantic color names). Run: `node scripts/gen-themes.mjs`.
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = 'https://github.com/BeardedBear/bearded-theme.git';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'themes.gen.ts');

const dir = mkdtempSync(join(tmpdir(), 'bearded-'));
execSync(`git clone --depth 1 ${REPO} ${dir}`, { stdio: 'inherit' });
const z = JSON.parse(readFileSync(join(dir, 'dist/zed/themes/bearded-theme.json'), 'utf8'));

// Flatten to 6-digit hex; 8-digit alpha is composited over `bg` (OpenTUI wants
// solid hex, and our surfaces/borders are opaque anyway).
function flat(hex, bg) {
  if (!hex || hex === 'transparent') return bg;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 6) return '#' + h.toLowerCase();
  const a = parseInt(h.slice(6, 8), 16) / 255;
  let b = (bg || '#000000').replace('#', '');
  if (b.length === 3) b = b.split('').map((c) => c + c).join('');
  const mix = (i) => {
    const f = parseInt(h.slice(i, i + 2), 16);
    const bb = parseInt(b.slice(i, i + 2), 16);
    return Math.round(f * a + bb * (1 - a)).toString(16).padStart(2, '0');
  };
  return '#' + mix(0) + mix(2) + mix(4);
}

// Zed style key -> our palette. `text.accent` is each variant's signature hue
// (Gold->gold, Ruby->ruby, Coffee->coral) — what drives the wordmark/primary;
// `modified` is the theme blue, `renamed` the violet.
function palette(s) {
  const bg = s.background;
  const f = (k) => flat(s[k], bg);
  return {
    background: flat(s.background, '#000000'),
    backgroundPanel: f('elevated_surface.background'),
    backgroundElement: f('element.background'),
    border: f('border'),
    borderActive: f('border.focused'),
    borderSubtle: f('border.variant'),
    text: f('text'),
    textMuted: f('text.muted'),
    primary: f('text.accent'),
    secondary: f('modified'),
    accent: f('renamed'),
    error: f('error'),
    warning: f('warning'),
    info: f('terminal.ansi.cyan'),
    yellow: f('terminal.ansi.yellow'),
    success: f('success'),
    green: f('success'),
  };
}

const themes = {};
const appearance = {};
const order = [];
for (const t of z.themes) {
  const name = t.name.replace(/^Bearded Theme\s*/, '').trim();
  themes[name] = palette(t.style);
  appearance[name] = t.appearance;
  order.push(name);
}

const KEYS = Object.keys(palette(z.themes[0].style));
const row = (p) => '{ ' + KEYS.map((k) => `${k}: '${p[k]}'`).join(', ') + ' }';

writeFileSync(
  OUT,
  `// AUTO-GENERATED from BeardedBear/bearded-theme (Zed build, ${z.themes.length} themes).
// Regenerate with \`node scripts/gen-themes.mjs\` — do not edit by hand.
// Source: https://github.com/BeardedBear/bearded-theme (MIT)

export interface Palette {
${KEYS.map((k) => `  ${k}: string;`).join('\n')}
}

export const THEMES: Record<string, Palette> = {
${order.map((n) => `  ${JSON.stringify(n)}: ${row(themes[n])},`).join('\n')}
};

export const THEME_NAMES: string[] = [
${order.map((n) => `  ${JSON.stringify(n)},`).join('\n')}
];

export const THEME_APPEARANCE: Record<string, 'dark' | 'light'> = {
${order.map((n) => `  ${JSON.stringify(n)}: '${appearance[n]}',`).join('\n')}
};
`,
);
console.log(`wrote ${OUT} — ${order.length} themes`);
