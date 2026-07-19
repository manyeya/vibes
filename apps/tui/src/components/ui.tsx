import { useEffect, useRef, useState } from 'react';
import { theme } from '../theme';

/**
 * Keep a keyboard-selected row visible inside a <scrollbox>. Manual lists (the
 * dialogs, the slash palette) move a `selected` index with ↑↓, but the scrollbox
 * doesn't follow on its own — so a selection past the fold scrolls off-screen.
 * Attach the returned ref to the <scrollbox> and pass the selected row's line
 * offset + the viewport height; it nudges scrollTop to keep it in view.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useScrollFollow(selectedLine: number, viewportHeight: number): React.RefObject<any> {
  const ref = useRef<{ scrollTop: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || selectedLine < 0 || viewportHeight <= 0) return;
    if (selectedLine < el.scrollTop) el.scrollTop = selectedLine;
    else if (selectedLine >= el.scrollTop + viewportHeight) el.scrollTop = selectedLine - viewportHeight + 1;
  }, [selectedLine, viewportHeight]);
  return ref;
}

/**
 * Pointer-hover state for a Renderable. OpenTUI fires onMouseOver/onMouseOut as
 * the pointer enters/leaves an element's bounds; spread the returned handlers
 * onto any <box>/<text> to get a `hovered` flag for feedback.
 */
export function useHover() {
  const [hovered, setHovered] = useState(false);
  return {
    hovered,
    onMouseOver: () => setHovered(true),
    onMouseOut: () => setHovered(false),
  };
}

/**
 * The single progressive-disclosure affordance, used everywhere overflow is
 * hidden (command output, diffs, file lists, delegation detail). Collapsed it
 * reads `▸ N more …`; expanded, `▾ show less`. Click it (or it's driven by a
 * parent key) to toggle. Hover brightens it so it reads as interactive — the
 * one gesture the whole UI shares, so revealing anything feels the same.
 */
export function Disclosure({
  expanded,
  count,
  noun,
  onToggle,
  indent = 5,
}: {
  expanded: boolean;
  /** Hidden-item count (shown when collapsed). */
  count: number;
  /** Singular noun, e.g. 'line', 'file'. */
  noun: string;
  onToggle: () => void;
  indent?: number;
}) {
  const { hovered, onMouseOver, onMouseOut } = useHover();
  const label = expanded ? '▾ show less' : `▸ ${count} more ${count === 1 ? noun : `${noun}s`}`;
  return (
    <box
      paddingLeft={indent}
      flexShrink={0}
      onMouseOver={onMouseOver}
      onMouseOut={onMouseOut}
      onMouseDown={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <text fg={hovered ? theme.primary : theme.textMuted} wrapMode="none">
        {label}
      </text>
    </box>
  );
}
