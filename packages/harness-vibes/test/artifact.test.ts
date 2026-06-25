import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ArtifactPlugin, { validateArtifact } from '../src/plugins/artifact';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'vibes-artp-')); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const mkPlugin = () => new ArtifactPlugin({ baseDir: tmp() }) as any;
const create = (p: any, args: any) => p.tools.create_artifact.execute(args);
const edit = (p: any, args: any) => p.tools.edit_artifact.execute(args);

describe('edit_artifact (surgical replace)', () => {
  test('replaces a unique substring and bumps the version', async () => {
    const p = mkPlugin();
    const { id } = await create(p, { title: 'Doc', kind: 'markdown', content: '# Title\n\nhello world' });
    const res = await edit(p, { id, old_string: 'hello world', new_string: 'goodbye moon' });
    expect(res.success).toBe(true);
    expect(res.version).toBe(2);
    expect(res.replaced).toBe(1);
    // Re-edit reads back the persisted new content.
    const res2 = await edit(p, { id, old_string: 'goodbye moon', new_string: 'done' });
    expect(res2.version).toBe(3);
  });

  test('replace_all replaces every occurrence; a literal $ in new_string is safe', async () => {
    const p = mkPlugin();
    const { id } = await create(p, { title: 'D', kind: 'markdown', content: 'a a a' });
    const res = await edit(p, { id, old_string: 'a', new_string: '$1', replace_all: true });
    expect(res.replaced).toBe(3);
    // List shows it's still one artifact at the new version.
    const list = await p.tools.list_artifacts.execute({});
    expect(list.count).toBe(1);
    expect(list.artifacts[0].version).toBe(2);
  });

  test('rejects: missing id, not-found string, ambiguous match, and no-op', async () => {
    const p = mkPlugin();
    const { id } = await create(p, { title: 'D', kind: 'markdown', content: 'x x y' });
    expect(edit(p, { id: 'nope', old_string: 'x', new_string: 'z' })).rejects.toThrow(/No artifact/);
    expect(edit(p, { id, old_string: 'zzz', new_string: 'z' })).rejects.toThrow(/not found/);
    expect(edit(p, { id, old_string: 'x', new_string: 'z' })).rejects.toThrow(/occurs 2×/);
    expect(edit(p, { id, old_string: 'y', new_string: 'y' })).rejects.toThrow(/identical/);
  });
});

describe('full regeneration is create_artifact with the same id (not edit)', () => {
  test('create_artifact with an existing id replaces content + bumps version in place', async () => {
    const p = mkPlugin();
    const { id } = await create(p, { title: 'Site', kind: 'html', content: '<html><body>old</body></html>' });
    const res = await create(p, { id, title: 'Site', kind: 'html', content: '<html><body>brand new</body></html>' });
    expect(res.success).toBe(true);
    expect(res.id).toBe(id);       // same artifact, in place
    expect(res.version).toBe(2);   // version bumped, not a fresh v1
    // Still ONE artifact, and a surgical edit sees the regenerated content.
    const list = await p.tools.list_artifacts.execute({});
    expect(list.count).toBe(1);
    const res2 = await edit(p, { id, old_string: 'brand new', new_string: 'newer' });
    expect(res2.version).toBe(3);
  });

  test('edit_artifact has no content/full-rewrite escape hatch (extra content arg is ignored)', async () => {
    const p = mkPlugin();
    const { id } = await create(p, { title: 'D', kind: 'markdown', content: 'hello world' });
    // `content` isn't in edit's schema; the surgical replace still runs on old_string.
    const res = await edit(p, { id, old_string: 'world', new_string: 'there', content: 'IGNORED' } as any);
    expect(res.replaced).toBe(1);
    expect(res.version).toBe(2);
  });
});

describe('edit_artifact metadata-only + guards', () => {
  test('title-only edit retitles without touching content', async () => {
    const p = mkPlugin();
    const { id } = await create(p, { title: 'Old Name', kind: 'markdown', content: 'keep me' });
    const res = await edit(p, { id, title: 'New Name' });
    expect(res.title).toBe('New Name');
    expect(res.version).toBe(2);
    const list = await p.tools.list_artifacts.execute({});
    expect(list.artifacts[0].title).toBe('New Name');
  });

  test('a truly empty edit is rejected', async () => {
    const p = mkPlugin();
    const { id } = await create(p, { title: 'D', kind: 'markdown', content: 'hello' });
    expect(edit(p, { id })).rejects.toThrow(/Nothing to change/);
  });

  test('ambiguous-match error offers replace_all AND regeneration (no loop)', async () => {
    const p = mkPlugin();
    const { id } = await create(p, { title: 'D', kind: 'markdown', content: 'a a a' });
    expect(edit(p, { id, old_string: 'a', new_string: 'b' })).rejects.toThrow(/replace_all/);
    expect(edit(p, { id, old_string: 'a', new_string: 'b' })).rejects.toThrow(/create_artifact/);
  });
});

describe('survives a session reload (persisted index)', () => {
  test('a fresh plugin instance keeps version monotonic + recovers the title', async () => {
    const dir = tmp();
    const p1 = new ArtifactPlugin({ baseDir: dir }) as any;
    const { id } = await p1.tools.create_artifact.execute({ title: 'Game', kind: 'html', content: '<html><body>v1</body></html>' });
    await p1.tools.edit_artifact.execute({ id, old_string: 'v1', new_string: 'v2' }); // -> version 2

    // Reload: brand-new instance, same dir, empty in-memory map.
    const p2 = new ArtifactPlugin({ baseDir: dir }) as any;
    const res = await p2.tools.edit_artifact.execute({ id, old_string: 'v2', new_string: 'v3' });
    expect(res.version).toBe(3); // continues from the index, NOT reset to 2 (which the canvas would drop)
    const list = await p2.tools.list_artifacts.execute({});
    expect(list.count).toBe(1);
    expect(list.artifacts[0].title).toBe('Game'); // recovered from index, not the bare id
  });
});

describe('validateArtifact (auto-scan)', () => {
  test('flags a stray code fence on non-markdown', () => {
    expect(validateArtifact('html', '```html\n<html></html>\n```').errors.join()).toMatch(/code fence/);
    expect(validateArtifact('markdown', '```js\ncode\n```').errors).toHaveLength(0);
  });

  test('mermaid: wrong directive is an error, good one is clean', () => {
    expect(validateArtifact('mermaid', 'flowchart TD\n  A-->B').errors).toHaveLength(0);
    expect(validateArtifact('mermaid', 'draw me a flowchart').errors.join()).toMatch(/not a known mermaid/);
  });

  test('html: truncation + unterminated script are errors', () => {
    expect(validateArtifact('html', '<!doctype html><html><body>ok</body></html>').errors).toHaveLength(0);
    expect(validateArtifact('html', '<html><body>cut off').errors.join()).toMatch(/truncated/);
    expect(validateArtifact('html', '<html><script>x()</html>').errors.join()).toMatch(/<script> is unbalanced/);
  });

  test('chart: invalid JSON / shape is an error', () => {
    expect(validateArtifact('chart', '{ not json').errors.length).toBeGreaterThan(0);
    expect(validateArtifact('chart', JSON.stringify({ type: 'bar', data: [{ label: 'a', value: 1 }] })).errors).toHaveLength(0);
  });
});

describe('create/update surface validation', () => {
  test('broken html still saves but returns a validation block', async () => {
    const p = mkPlugin();
    const res = await create(p, { title: 'Site', kind: 'html', content: '<html><body>oops' });
    expect(res.success).toBe(true);
    expect(res.validation.errors.length).toBeGreaterThan(0);
    expect(res.message).toMatch(/edit_artifact/);
  });

  test('invalid chart is a hard gate (throws, never saves)', async () => {
    const p = mkPlugin();
    expect(create(p, { title: 'C', kind: 'chart', content: '{bad' })).rejects.toThrow();
  });
});
