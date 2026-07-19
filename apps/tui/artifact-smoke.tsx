// Isolated check for the artifact viewer: list renders, enter opens the
// markdown view, esc goes back, esc again closes. No backend needed.
// Run: bun run artifact-smoke.tsx
import { testRender } from '@opentui/react/test-utils';
import { useState } from 'react';
import { ArtifactDialog, type ArtifactData } from './src/components/artifact-dialog';

const ARTIFACTS: ArtifactData[] = [
  { id: 'a1', title: 'Readme', kind: 'markdown', content: '# Hello\n\nsome **markdown** body', version: 1 },
  { id: 'a2', title: 'Landing page', kind: 'html', content: '<h1>hi</h1>', version: 3, status: 'streaming' },
];

let closed = false;
function Host() {
  const [open, setOpen] = useState(true);
  if (!open) return <text>CLOSED</text>;
  return <ArtifactDialog artifacts={ARTIFACTS} onClose={() => { closed = true; setOpen(false); }} />;
}

const { renderOnce, captureCharFrame, mockInput } = await testRender(<Host />, { width: 80, height: 24 });

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

await expect('list shows both artifacts', (f) => f.includes('Readme') && f.includes('Landing page') && f.includes('v3 …'));

await mockInput.pressEnter();
await expect('enter renders markdown view', (f) => f.includes('Hello') && f.includes('some markdown body') && f.includes('open in browser'));

await mockInput.pressEscape();
await expect('esc returns to list', (f) => f.includes('Artifacts') && f.includes('Landing page'));

await mockInput.pressEscape();
await expect('esc closes dialog', (f) => f.includes('CLOSED'));

console.log('--- all OK');
process.exit(0);
