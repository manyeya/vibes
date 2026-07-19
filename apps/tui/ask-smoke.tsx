// One-off check for the ask_user question form + data-part rendering.
import { testRender } from '@opentui/react/test-utils';
import { API_URL, deleteSession, listSessions } from './src/api';
import { App } from './src/app';

const PROMPT =
  'Use your ask_user tool to ask me ONE question: which color do I prefer, with options red, blue, green. Just ask and wait.';

const { renderOnce, captureCharFrame, mockInput } = await testRender(<App />, {
  width: 100,
  height: 34,
});

async function cleanup() {
  const sessions = await listSessions().catch(() => []);
  for (const s of sessions) {
    if ((s.metadata?.title as string | undefined)?.startsWith('Use your ask_user tool')) {
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

await until('home', (f) => f.includes('Fix a TODO'), 10_000);
await mockInput.typeText(PROMPT);
await renderOnce();
await mockInput.pressEnter();

// the question form should pin above the composer once the agent halts
await until(
  'question form',
  (f) => f.includes('↑↓ select') && f.toLowerCase().includes('red'),
  120_000,
);
console.log(captureCharFrame());

// pick option 2 (blue) → auto-submits the formatted answer, agent resumes
await mockInput.pressKey('2');
await until('answer sent', (f) => f.includes('Here are my answers'), 15_000);
await until(
  'agent resumed',
  (f) => f.includes('ctrl+l') && !f.includes('↑↓ select'),
  120_000,
);
console.log(captureCharFrame());

console.log('--- all OK');
await cleanup();
process.exit(0);
