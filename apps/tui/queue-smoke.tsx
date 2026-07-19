// Isolated check for message queueing + prompt hardening. Stubs fetch: the
// vibe stream is a held-open SSE response so `busy` stays true on demand.
// Run: bun run queue-smoke.tsx
import { testRender } from '@opentui/react/test-utils';

const streamPosts: string[] = [];
let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
let rejectNextPost = false;
const enc = new TextEncoder();
const sse = (obj: Record<string, unknown>) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.includes('/vibe/stream')) {
    if (rejectNextPost) {
      rejectNextPost = false;
      throw new Error('boom');
    }
    const body = init?.body ? String(init.body) : input instanceof Request ? await input.text() : '';
    streamPosts.push(body);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        c.enqueue(sse({ type: 'start' }));
      },
    });
    // Real fetch errors the body when its signal aborts; the SDK's stop()
    // relies on that, so the stub must simulate it or status never leaves
    // 'streaming'.
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.addEventListener('abort', () => {
      try {
        controller?.error(new DOMException('aborted', 'AbortError'));
      } catch {}
    });
    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
    });
  }
  // messages history, PATCH title, abort — all trivially succeed
  return new Response(JSON.stringify({ success: true, messages: [] }), {
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

function finishStream(text: string) {
  const c = controller!;
  c.enqueue(sse({ type: 'text-start', id: 't1' }));
  c.enqueue(sse({ type: 'text-delta', id: 't1', delta: text }));
  c.enqueue(sse({ type: 'text-end', id: 't1' }));
  c.enqueue(sse({ type: 'finish' }));
  c.close();
}

// Imported AFTER the fetch stub is installed — the AI SDK captures fetch at
// module load, so a static (hoisted) import would bypass the stub and hit the
// real API.
const { Session } = await import('./src/screens/session');

const { renderOnce, captureCharFrame, mockInput } = await testRender(
  <Session session={{ id: 'q1' }} active connected model="test/model" onAppAction={() => {}} />,
  { width: 100, height: 30 },
);

// The transport dispatches its fetch a microtask after `busy` flips, so POST
// counts must be awaited, not asserted synchronously.
async function untilPosts(what: string, cond: () => boolean) {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    if (cond()) {
      console.log(`--- ${what} OK`);
      return;
    }
    await renderOnce();
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`--- ${what} FAILED (posts=${streamPosts.length})`);
  process.exit(1);
}

function assertPosts(expected: number, why: string) {
  const n: number = streamPosts.length;
  if (n !== expected) throw new Error(`${why} (expected ${expected} POSTs, got ${n})`);
}

async function expect(what: string, pred: (f: string) => boolean) {
  const end = Date.now() + 4000;
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

// 1. submit while idle → streaming starts, busy row shows
await mockInput.typeText('first message');
await mockInput.pressEnter();
await expect('turn is busy', (f) => f.includes('interrupt'));
await untilPosts('first POST recorded', () => streamPosts.length === 1);

// 2. submit while busy → queued row, no extra POST
await mockInput.typeText('second message');
await mockInput.pressEnter();
await expect('message queued', (f) => f.includes('› second message'));
assertPosts(1, 'queued message must not POST');

// 3. natural finish → queue auto-sends as one follow-up POST
finishStream('pong');
await untilPosts('queue auto-sent as follow-up POST', () => streamPosts.length === 2 && streamPosts[1]!.includes('second message'));
await expect('queue row cleared', (f) => !f.includes('› second message'));

// 4. queue + esc interrupt → restored to composer, NOT sent
await mockInput.typeText('third message');
await mockInput.pressEnter();
await expect('second queue shows', (f) => f.includes('› third message'));
await mockInput.pressEscape();
await expect('interrupt restores queue to composer', (f) => !f.includes('› third message') && f.includes('third message'));
assertPosts(2, 'interrupted queue must not POST');

// 5. failed send → composer text restored next to the error block
rejectNextPost = true;
await mockInput.pressEnter(); // composer still holds "third message"
await expect('failed send restores text', (f) => f.includes('third message') && f.toLowerCase().includes('boom'));
assertPosts(2, 'rejected POST must not be recorded');

console.log('--- all OK');
process.exit(0);
