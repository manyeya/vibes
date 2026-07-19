// One-off check: model dialog + data-command/file_operation rendering.
import { testRender } from '@opentui/react/test-utils';
import { API_URL, deleteSession, listSessions } from './src/api';
import { App } from './src/app';

const PROMPT = 'Use your bash tool to run `echo hello-tui`, then use readFile on package.json. Then say done.';

const { renderOnce, captureCharFrame, mockInput } = await testRender(<App />, {
  width: 100,
  height: 34,
});

async function cleanup() {
  const sessions = await listSessions().catch(() => []);
  for (const s of sessions) {
    if ((s.metadata?.title as string | undefined)?.startsWith('Use your bash tool')) {
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

// model dialog
await mockInput.pressKey('o', { ctrl: true });
await until('model dialog', (f) => f.includes('Models') && f.includes('enter select'), 10_000);
console.log(captureCharFrame());
await mockInput.pressEscape();
await until('dialog closed', (f) => !f.includes('Models'), 5_000);

// tools rendering
await mockInput.typeText(PROMPT);
await renderOnce();
await mockInput.pressEnter();
await until(
  'tools rendered',
  (f) => f.includes('$ echo hello-tui') && f.includes('Read package.json') && f.includes('ctrl+l'),
  180_000,
);
console.log(captureCharFrame());

console.log('--- all OK');
await cleanup();
process.exit(0);
