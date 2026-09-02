import { dotenvLoad } from 'dotenv-mono';
import { loadCredentialsIntoEnv, hasProviderKey, PROVIDER_KEYS } from './credentials';

let loaded = false;

/**
 * Resolve credentials into `process.env`. Precedence, highest first:
 *   1. the real environment (CI / `export`) and the repo/monorepo `.env` (dev)
 *   2. the OS-keychain credential store — the source of truth for installs
 *
 * The keychain replaced `~/.vibes/.env`; nothing sensitive is read from a
 * plaintext file. Idempotent.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  dotenvLoad(); // repo / monorepo .env in dev; a harmless no-op when installed
  loadCredentialsIntoEnv(); // keychain store fills whatever the env didn't set
}

export { hasProviderKey, PROVIDER_KEYS };
