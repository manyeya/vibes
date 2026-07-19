// Isolated check for slash commands + help overlay. No backend needed:
// health/getModels/listSessions fail silently and dialog chrome still renders.
// Run: bun run slash-smoke.tsx
import { KeyCodes } from '@opentui/core/testing';
import { testRender } from '@opentui/react/test-utils';
import { App } from './src/app';

const { renderOnce, captureCharFrame, mockInput } = await testRender(<App />, { width: 100, height: 30 });

async function expect(what: string, pred: (f: string) => boolean) {
  const end = Date.now() + 3000;
  let frame = '';
  while (Date.now() < end) {
    await renderOnce();
    frame = captureCharFrame();
    if (pred(frame)) {
      console.log(`--- ${what} OK`);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`--- ${what} FAILED. Frame:\n${frame}`);
  process.exit(1);
}

// /help opens the help overlay (suggestion row should appear while typing)
await mockInput.typeText('/hel');
await expect('suggestion row shows /help', (f) => f.includes('/help') && f.includes('keys & commands'));
await mockInput.typeText('p');
await mockInput.pressEnter();
await expect('/help opens overlay', (f) => f.includes('Help') && f.includes('/artifacts') && f.includes('interrupt / close dialog'));

await mockInput.pressEscape();
await expect('esc closes help', (f) => !f.includes('interrupt / close dialog'));

// f1 reopens it
mockInput.pressKey(KeyCodes.F1);
await expect('f1 opens overlay', (f) => f.includes('interrupt / close dialog'));
await mockInput.pressEscape();
// A lone ESC is held by the key parser to disambiguate ESC-prefixed sequences;
// polling here lets it flush before the next keystrokes arrive.
await expect('esc closes help again', (f) => !f.includes('interrupt / close dialog'));

// /model opens the model dialog (offline → empty list)
await mockInput.typeText('/model');
await mockInput.pressEnter();
// Works online (real catalog) and offline ('No results found') alike.
await expect('/model opens Models dialog', (f) => f.includes('Models') && f.includes('Search'));
await mockInput.pressEscape();

// unknown command opens nothing and creates no session
await mockInput.typeText('/bogus');
await mockInput.pressEnter();
await expect('/bogus is ignored on home', (f) => !f.includes('Models') && !f.includes('Sessions') && !f.includes('interrupt / close dialog'));

console.log('--- all OK');
process.exit(0);
