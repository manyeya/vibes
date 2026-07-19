// End-to-end smoke check: drives the real TUI headlessly against a live backend.
// Needs `bun run dev:api` running and makes ONE real model call (cheap prompt).
// Run: bun run smoke.tsx
import { testRender } from '@opentui/react/test-utils';
import { API_URL, deleteSession, listSessions } from './src/api';
import { App } from './src/app';

const PROMPT = 'Reply with exactly the word pong and nothing else.';

const { renderOnce, captureCharFrame, mockInput } = await testRender(<App />, {
  width: 100,
  height: 32,
});

async function cleanup() {
  const sessions = await listSessions().catch(() => []);
  for (const s of sessions) {
    if ((s.metadata?.title as string | undefined)?.startsWith(PROMPT.slice(0, 40))) {
      await deleteSession(s.id).catch(() => {});
    }
  }
}

async function until(what: string, pred: (f: string) => boolean, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 250));
    await renderOnce();
    if (pred(captureCharFrame())) {
      console.log(`--- ${what} OK`);
      return;
    }
  }
  console.log(`--- ${what} TIMED OUT against ${API_URL}. Last frame:`);
  console.log(captureCharFrame());
  await cleanup();
  process.exit(1);
}

// 1. home: logo + composer + footer
await until('home', (f) => f.includes('Fix a TODO') && f.includes('connected'), 10_000);
console.log(captureCharFrame());

// 2. type + submit → session created, message streamed
await mockInput.typeText(PROMPT);
await renderOnce();
await mockInput.pressEnter();
await until(
  'stream',
  (f) => f.toLowerCase().includes('pong') && f.includes('ctrl+l'),
  120_000,
);
console.log(captureCharFrame());

// 3. ctrl+l → sessions dialog
await mockInput.pressKey('l', { ctrl: true });
await until('dialog', (f) => f.includes('Sessions') && f.includes(PROMPT.slice(0, 20)), 10_000);
console.log(captureCharFrame());

// 4. enter opens the selected (current) session again — history reloads
await mockInput.pressEnter();
await until('history reload', (f) => f.toLowerCase().includes('pong') && !f.includes('Sessions'), 15_000);

console.log('--- all OK');
await cleanup();
process.exit(0);
