#!/usr/bin/env bun
/**
 * `vibes` — run the Vibes coding agent in the current repo.
 *
 *   cd any-repo && vibes
 *
 * Boots the API as a child (ephemeral port, state in ~/.vibes), waits for it,
 * then launches the terminal UI pointed at it and rooted at the cwd. Model
 * keys live in the OS keychain (see `vibes login`); the API is stopped on exit.
 */
import { openSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { dotenvLoad } from 'dotenv-mono';
import {
  setCredential, deleteCredential, listCredentialNames, clearStore,
  hasProviderKey, activeBackend, KNOWN_KEYS,
} from '../apps/api/src/credentials';

const whereStored = () => activeBackend() === 'keychain'
  ? 'the OS keychain'
  : '~/.vibes/credentials.json (encrypted — no OS keychain available on this system)';

const pkgRoot = resolve(import.meta.dir, '..');
const argv = process.argv.slice(2);
const has = (...names: string[]) => argv.some((a) => names.includes(a));
const opt = (...names: string[]): string | undefined => {
  const i = argv.findIndex((a) => names.includes(a));
  if (i < 0) return undefined;
  const inline = argv[i].includes('=') ? argv[i].split('=').slice(1).join('=') : undefined;
  return inline ?? argv[i + 1];
};
const readVersion = () => {
  try { return JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version ?? '0.0.0'; }
  catch { return '0.0.0'; }
};

// Read one line with the terminal echo off — for pasting a secret.
async function promptSecret(label: string): Promise<string> {
  process.stdout.write(label);
  const stdin = process.stdin as NodeJS.ReadStream;
  const wasRaw = stdin.isRaw ?? false;
  stdin.setRawMode?.(true);
  stdin.resume();
  let buf = '';
  try {
    outer: for await (const chunk of stdin) {
      for (const ch of chunk.toString('utf8')) {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10) break outer;                         // Enter
        if (code === 3) { process.stdout.write('\n'); process.exit(130); }    // Ctrl-C
        if (code === 127 || code === 8) { buf = buf.slice(0, -1); continue; } // backspace / DEL
        if (code < 32) continue;                                             // ignore other control chars
        buf += ch;
      }
    }
  } finally {
    stdin.setRawMode?.(wasRaw);
    stdin.pause();
    process.stdout.write('\n');
  }
  return buf.trim();
}

function printHelp() {
  console.log(`vibes — run the Vibes coding agent in the current directory

Usage:
  vibes [options]              Launch in the current repo
  vibes login [KEY]            Store a model-provider key in the OS keychain
                               (KEY defaults to OPENROUTER_API_KEY)
  vibes keys [list]            List stored credential names
  vibes keys add <KEY>         Add/replace a credential
  vibes keys rm <KEY>          Remove a credential
  vibes logout                 Remove all stored credentials

Options:
  -h, --help                   Show this help
  -v, --version                Print the version
  --port <n>                   Pin the API port (default: an ephemeral free port)
  --home <dir>                 State directory ($VIBES_HOME, default ~/.vibes)
  --api-url <url>              Attach to an already-running API

Keys are stored in your OS keychain, never a plaintext file. Environment
variables still take precedence (CI). Known keys: ${KNOWN_KEYS.join(', ')}.`);
}

// ── credential subcommands ──
async function runLogin(key = 'OPENROUTER_API_KEY') {
  if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
    console.error(`Unknown key "${key}". Known: ${KNOWN_KEYS.join(', ')}`);
    process.exit(1);
  }
  const value = await promptSecret(`Paste ${key} (hidden): `);
  if (!value) { console.error('No value entered.'); process.exit(1); }
  setCredential(key, value);
  console.log(`Saved ${key} to ${whereStored()}.`);
}

async function runKeys() {
  const sub = argv[1];
  if (!sub || sub === 'list') {
    const names = listCredentialNames();
    console.log(`store: ${whereStored()}`);
    console.log(names.length ? names.join('\n') : 'No stored credentials. Run `vibes login`.');
    return;
  }
  if (sub === 'add') { await runLogin(argv[2] ?? 'OPENROUTER_API_KEY'); return; }
  if (sub === 'rm' || sub === 'remove') {
    const key = argv[2];
    if (!key) { console.error('Usage: vibes keys rm <KEY>'); process.exit(1); }
    console.log(deleteCredential(key) ? `Removed ${key}.` : `${key} was not set.`);
    return;
  }
  console.error(`Unknown: vibes keys ${sub}`);
  process.exit(1);
}

// ── dispatch ──
if (has('-h', '--help')) { printHelp(); process.exit(0); }
if (has('-v', '--version')) { console.log(readVersion()); process.exit(0); }
const cmd = argv[0];
if (cmd === 'login') { await runLogin(argv[1] ?? 'OPENROUTER_API_KEY'); process.exit(0); }
if (cmd === 'keys') { await runKeys(); process.exit(0); }
if (cmd === 'logout') { clearStore(); console.log('Cleared all stored credentials.'); process.exit(0); }

// ── launch ──
const VIBES_HOME = process.env.VIBES_HOME?.trim()
  ? resolve(process.env.VIBES_HOME)
  : opt('--home') ? resolve(opt('--home')!) : join(homedir(), '.vibes');
process.env.VIBES_HOME = VIBES_HOME;
mkdirSync(VIBES_HOME, { recursive: true });

dotenvLoad(); // repo .env in a dev checkout; env vars still win over the store
if (!hasProviderKey()) {
  console.error(
    `vibes: no model-provider key found.\n\n` +
    `Run:  vibes login          # securely stores a key in your OS keychain\n` +
    `                           # free, tool-capable keys at https://openrouter.ai/keys`);
  process.exit(1);
}

const pick = (candidates: string[]) => candidates.find((p) => existsSync(p));
const apiEntry = pick([join(pkgRoot, 'dist/api.js'), join(pkgRoot, 'apps/api/src/index.ts')]);
const tuiEntry = pick([join(pkgRoot, 'dist/tui.js'), join(pkgRoot, 'apps/tui/src/index.tsx')]);
if (!apiEntry || !tuiEntry) {
  console.error('vibes: could not locate the app entry points. Reinstall, or run `bun run vibes:build`.');
  process.exit(1);
}

const projectDir = process.cwd();
const logFd = openSync(join(VIBES_HOME, 'vibes-cli.log'), 'a');

let api: ReturnType<typeof Bun.spawn> | undefined;
let apiUrl = opt('--api-url');
if (!apiUrl) {
  let port = Number(opt('--port'));
  if (!port) {
    const probe = Bun.serve({ port: 0, fetch: () => new Response('') });
    port = probe.port;
    probe.stop(true);
  }
  apiUrl = `http://127.0.0.1:${port}`;
  api = Bun.spawn({
    cmd: ['bun', 'run', apiEntry],
    cwd: pkgRoot,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', VIBES_HOME },
    stdout: logFd,
    stderr: logFd,
  });
}

const deadline = Date.now() + 25_000;
let up = false;
while (Date.now() < deadline) {
  try { if ((await fetch(`${apiUrl}/api/health`)).ok) { up = true; break; } } catch { /* not up yet */ }
  if (api && api.exitCode !== null) break;
  await Bun.sleep(250);
}
if (!up) {
  try { api?.kill(); } catch { /* already gone */ }
  console.error(`vibes: the API at ${apiUrl} did not respond. See ${join(VIBES_HOME, 'vibes-cli.log')}`);
  process.exit(1);
}

const tui = Bun.spawn({
  cmd: ['bun', 'run', tuiEntry],
  cwd: projectDir,
  env: { ...process.env, VIBES_API_URL: apiUrl, VIBES_PROJECT_DIR: projectDir },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});

let stopped = false;
const cleanup = () => { if (stopped) return; stopped = true; try { api?.kill(); } catch { /* already gone */ } };
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });
process.on('exit', cleanup);

const code = await tui.exited;
cleanup();
process.exit(code ?? 0);
