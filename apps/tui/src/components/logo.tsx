import { TextAttributes } from '@opentui/core';
import { useEffect, useState } from 'react';
import { theme } from '../theme';

// "vibes" in a slanted wordmark — its own letterform (not opencode's upright
// half-blocks), colored with a left→right primary→accent gradient so it wears
// the active theme. Gradient is per-column, so the fill shifts as you switch.
const WORDMARK = [
  '        _ __             ',
  ' _   __(_) /_  ___  _____',
  '| | / / / __ \\/ _ \\/ ___/',
  '| |/ / / /_/ /  __(__  ) ',
  '|___/_/_.___/\\___/____/  ',
];
const WIDTH = Math.max(...WORDMARK.map((l) => l.length));

// Entrance: rows fade up in a stagger — a rare, once-per-launch delight, so a
// little grace is warranted. No motion (the grid can't do sub-cell), just a
// brightness fade from the background, which is also reduced-motion-safe.
const STAGGER = 70; // ms between rows (Emil's 30–80ms cascade)
const ROW_FADE = 220; // ms per row — entering, ease-out, kept under 300ms
const DURATION = (WORDMARK.length - 1) * STAGGER + ROW_FADE;

// Strong ease-out (outExpo): instant response, gentle settle — the punch the
// built-in curves lack.
const easeOut = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

// Linear blend between two #rrggbb hex colors at t∈[0,1].
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) =>
    Math.round(((pa >> shift) & 0xff) * (1 - t) + ((pb >> shift) & 0xff) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

export function Logo() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      const e = Date.now() - start;
      setElapsed(e);
      if (e >= DURATION) clearInterval(timer);
    }, 40);
    return () => clearInterval(timer);
  }, []);

  return (
    <box>
      {WORDMARK.map((line, row) => {
        const reveal = easeOut(Math.max(0, Math.min(1, (elapsed - row * STAGGER) / ROW_FADE)));
        return (
          <box key={row} flexDirection="row">
            {Array.from(line.padEnd(WIDTH)).map((char, col) =>
              char === ' ' ? (
                <text key={col}> </text>
              ) : (
                <text
                  key={col}
                  fg={mix(theme.background, mix(theme.primary, theme.accent, col / (WIDTH - 1)), reveal)}
                  attributes={TextAttributes.BOLD}
                >
                  {char}
                </text>
              ),
            )}
          </box>
        );
      })}
    </box>
  );
}
