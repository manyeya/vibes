import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { theme } from '../theme';

export interface MenuItem {
  label: string;
  /** Right-aligned keybind, shown inline in the popup. */
  hint?: string;
  /** One-line explanation, shown in the centered command palette. */
  description?: string;
  onSelect: () => void;
}

/**
 * The action menu, built on OpenTUI's real <select> (keyboard-driven: ↑↓ move,
 * enter runs, esc / click-away closes). Two shapes from one list:
 *   - `popup`   — compact, anchored at the cursor (right-click).
 *   - `palette` — big, centered, with descriptions (ctrl+p command palette).
 */
export function ContextMenu({
  items,
  variant = 'popup',
  x = 0,
  y = 0,
  onClose,
}: {
  items: MenuItem[];
  variant?: 'popup' | 'palette';
  x?: number;
  y?: number;
  onClose: () => void;
}) {
  const { width, height } = useTerminalDimensions();
  const palette = variant === 'palette';

  const options = items.map((it) => ({
    name: palette ? it.label : it.hint ? `${it.label}   ${it.hint}` : it.label,
    description: it.description ?? '',
    value: it.label,
  }));

  useKeyboard((key) => {
    if (key.name === 'escape') onClose();
  });

  const contentW = Math.max(24, ...options.map((o) => o.name.length + (palette ? 0 : 4)));
  const menuWidth = palette ? Math.min(74, width - 4) : Math.min(contentW + 2, width - 2);
  // Palette shows a description line under each item (2 rows/item); popup is 1.
  const listHeight = Math.min(items.length * (palette ? 2 : 1) + 1, palette ? 22 : 12);

  const left = palette ? Math.floor((width - menuWidth) / 2) : Math.max(0, Math.min(x, width - menuWidth - 1));
  const top = palette ? Math.floor(height / 5) : Math.max(0, Math.min(y, height - listHeight - 3));

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      zIndex={4000}
      onMouseDown={onClose}
    >
      <box
        position="absolute"
        left={left}
        top={top}
        width={menuWidth}
        backgroundColor={theme.backgroundPanel}
        border
        borderStyle="rounded"
        borderColor={theme.borderActive}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={palette ? 1 : 0}
        paddingBottom={palette ? 1 : 0}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {palette ? (
          <box paddingLeft={1} paddingBottom={1} flexDirection="row" justifyContent="space-between">
            <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
              Command palette
            </text>
            <text fg={theme.textMuted} wrapMode="none">
              ↑↓ · enter · esc
            </text>
          </box>
        ) : null}
        <select
          focused
          options={options}
          height={listHeight}
          showDescription={palette}
          showScrollIndicator
          wrapSelection
          backgroundColor={theme.backgroundPanel}
          focusedBackgroundColor={theme.backgroundPanel}
          selectedBackgroundColor={theme.primary}
          selectedTextColor={theme.background}
          textColor={theme.text}
          descriptionColor={theme.textMuted}
          selectedDescriptionColor={theme.background}
          onSelect={(index: number) => {
            const item = items[index];
            if (item) {
              item.onSelect();
              onClose();
            }
          }}
        />
      </box>
    </box>
  );
}
