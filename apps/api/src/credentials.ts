import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

/**
 * Credential store — the single source of truth for API keys.
 *
 * Primary backend is the OS keychain (macOS Keychain / Windows Credential
 * Manager / Linux Secret Service) via @napi-rs/keyring, loaded LAZILY so a
 * missing or unusable native module (e.g. headless Linux with no D-Bus Secret
 * Service) never crashes the app. When the keychain is unavailable, it falls
 * back to an encrypted file at `~/.vibes/credentials.json` (AES-256-GCM) — the
 * same keychain-then-file pattern gh / aws / npm / docker use.
 *
 * Explicit environment variables always win, so CI just exports them.
 *
 * Honest note on the file fallback: the master key sits in `~/.vibes` (env
 * `CREDENTIAL_ENCRYPTION_KEY`, else an auto-generated `~/.vibes/credential-key`
 * at mode 0600). This protects against accidental commits, backups and a casual
 * `cat` — NOT a local attacker who can already read your `~/.vibes`. Use the
 * OS keychain (the default when available) for real at-rest protection.
 */

const SERVICE = 'vibes';
const ACCOUNT = 'credentials';

/** Model-provider keys, in the order model-factory prefers them. */
export const PROVIDER_KEYS = ['AI_GATEWAY_API_KEY', 'ZHIPU_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'] as const;

/** All keys the store recognises (model providers + web search + model override). */
export const KNOWN_KEYS = [
  ...PROVIDER_KEYS,
  'EXA_API_KEY', 'TAVILY_API_KEY', 'BRAVE_API_KEY',
  'OPENROUTER_MODEL',
] as const;
export type KnownKey = (typeof KNOWN_KEYS)[number];

// Resolve the state dir at call time (VIBES_HOME can be set after import).
const vibesHome = () => (process.env.VIBES_HOME?.trim() ? resolve(process.env.VIBES_HOME) : join(homedir(), '.vibes'));
const credFile = () => join(vibesHome(), 'credentials.json');
const keyFile = () => join(vibesHome(), 'credential-key');

// ── keychain backend (lazy, never throws on load) ──
type Keyring = { getPassword(): string | null; setPassword(v: string): void; deletePassword(): void };
const nodeRequire = createRequire(import.meta.url);
let probe: 'unknown' | 'available' | 'unavailable' = 'unknown';
let EntryCtor: (new (service: string, account: string) => Keyring) | null = null;

function keyring(): Keyring | null {
  if (probe === 'unavailable' || process.env.VIBES_NO_KEYCHAIN) return null;
  try {
    if (!EntryCtor) EntryCtor = nodeRequire('@napi-rs/keyring').Entry;
    const entry = new EntryCtor!(SERVICE, ACCOUNT);
    if (probe === 'unknown') { entry.getPassword(); probe = 'available'; } // probe the backend once
    return entry;
  } catch {
    probe = 'unavailable'; // no native module, or no Secret Service (headless Linux)
    return null;
  }
}

/** Which backend is active: 'keychain' when the OS store works, else 'file'. */
export function activeBackend(): 'keychain' | 'file' {
  return keyring() ? 'keychain' : 'file';
}

// ── encrypted-file backend ──
function masterKey(): Buffer {
  const env = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (env) {
    if (!/^[0-9a-fA-F]{64}$/.test(env)) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
    return Buffer.from(env, 'hex');
  }
  const kf = keyFile();
  if (existsSync(kf)) return Buffer.from(readFileSync(kf, 'utf8').trim(), 'hex');
  const key = randomBytes(32);
  mkdirSync(dirname(kf), { recursive: true });
  writeFileSync(kf, key.toString('hex'), { mode: 0o600 });
  try { chmodSync(kf, 0o600); } catch { /* Windows: perms are best-effort */ }
  return key;
}

function readEncryptedFile(): string | null {
  const f = credFile();
  if (!existsSync(f)) return null;
  const { iv, tag, data } = JSON.parse(readFileSync(f, 'utf8')) as { iv: string; tag: string; data: string };
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

function writeEncryptedFile(plaintext: string): void {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const payload = JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: ct.toString('base64'),
  });
  const f = credFile();
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, payload, { mode: 0o600 });
  try { chmodSync(f, 0o600); } catch { /* Windows: perms are best-effort */ }
}

// ── unified store API (routes to the active backend) ──
export function readStore(): Record<string, string> {
  const kr = keyring();
  try {
    const raw = kr ? (kr.getPassword() as string | null) : readEncryptedFile();
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeStore(data: Record<string, string>): void {
  const json = JSON.stringify(data);
  const kr = keyring();
  if (kr) kr.setPassword(json);
  else writeEncryptedFile(json);
}

/** Store (or overwrite) a credential. */
export function setCredential(key: string, value: string): void {
  const data = readStore();
  data[key] = value;
  writeStore(data);
}

/** Remove a credential; returns false if it wasn't set. */
export function deleteCredential(key: string): boolean {
  const data = readStore();
  if (!(key in data)) return false;
  delete data[key];
  if (Object.keys(data).length === 0) clearStore();
  else writeStore(data);
  return true;
}

/** Wipe the whole store. */
export function clearStore(): void {
  const kr = keyring();
  if (kr) { try { kr.deletePassword(); } catch { /* nothing stored */ } }
  else { try { if (existsSync(credFile())) rmSync(credFile()); } catch { /* nothing to remove */ } }
}

/** Names of the stored credentials (never the values). */
export function listCredentialNames(): string[] {
  return Object.keys(readStore());
}

/**
 * Fill `process.env` from the store WITHOUT overriding anything the environment
 * already set (so CI / explicit exports stay authoritative). Called at boot.
 */
export function loadCredentialsIntoEnv(): void {
  for (const [k, v] of Object.entries(readStore())) {
    if (!process.env[k]?.trim()) process.env[k] = v;
  }
}

/** True if a model-provider key is available (environment or store). */
export function hasProviderKey(): boolean {
  const store = readStore();
  return PROVIDER_KEYS.some((k) => (process.env[k] ?? store[k])?.trim());
}
