import { useEffect, useState } from 'react';
import { SPINNER_FRAMES, theme } from '../theme';

export function Spinner({ color, children }: { color?: string; children?: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, []);
  const fg = color ?? theme.textMuted;
  return (
    <box flexDirection="row" gap={1}>
      <text fg={fg}>{SPINNER_FRAMES[frame]}</text>
      {children ? <text fg={fg}>{children}</text> : null}
    </box>
  );
}
