import { createCliRenderer, getTreeSitterClient } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './app';

// useMouse enables terminal mouse reporting so elements receive onMouseDown/
// onMouseScroll (right-click menus, click-to-select). Trade-off: native
// terminal text selection needs the OS modifier (Option/Fn+drag) while on.
const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true });

// Warm the tree-sitter grammars for the languages we're likely to diff. Only
// js/ts/markdown/zig are bundled; the rest download once (then cache), so kick
// them off now — best-effort, non-blocking, so diffs highlight by first edit.
try {
  const ts = getTreeSitterClient();
  for (const ft of ['typescriptreact', 'javascriptreact', 'typescript', 'javascript', 'html', 'css', 'json', 'python', 'rust', 'go', 'bash', 'yaml', 'markdown']) {
    ts.preloadParser(ft).catch(() => {});
  }
} catch {
  /* tree-sitter unavailable — diffs just render unhighlighted */
}

createRoot(renderer).render(<App />);
