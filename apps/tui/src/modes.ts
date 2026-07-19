// Mirrors harness-vibes AgentMode. Kept local so the TUI needn't resolve the
// package for four strings; the API validates the value server-side anyway.
import { theme } from './theme';

export const MODES = ['plan', 'manual', 'auto-edit', 'auto'] as const;
export type Mode = (typeof MODES)[number];

export const nextMode = (m: string): Mode => {
  const i = MODES.indexOf(m as Mode);
  return MODES[(i < 0 ? 0 : i + 1) % MODES.length]!;
};

// Glyph + color per mode: calm for auto, warmer/louder the more it gates.
export const modeStyle = (m: string): { glyph: string; color: string; label: string } => {
  switch (m) {
    case 'plan':
      return { glyph: '✎', color: theme.accent, label: 'plan' };
    case 'manual':
      return { glyph: '⏸', color: theme.warning, label: 'manual' };
    case 'auto-edit':
      return { glyph: '⏵⏵', color: theme.secondary, label: 'auto-edit' };
    default:
      return { glyph: '⏭', color: theme.success, label: 'auto' };
  }
};
