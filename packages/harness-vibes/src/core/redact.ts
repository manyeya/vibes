/**
 * Secret masking. A small, finite set of patterns for the credentials that
 * actually leak through agent tool I/O — API keys, cloud access keys, bearer
 * tokens / JWTs, provider tokens, and `KEY=VALUE` env lines. Applied to tool
 * results (and reused as a content guardrail) so a `bash` that echoes `$OPENAI_API_KEY`
 * or a file read of `.env` never reaches the model context or the stream.
 *
 * ponytail: the regex list IS the ceiling — extend the list, not the engine.
 * A determined exfiltration (base64, split across lines) gets past it; this is
 * leak hygiene, not a DLP product.
 */

const PLACEHOLDER = '***REDACTED***';

/** Patterns whose entire match is a secret. */
const SECRET_PATTERNS: RegExp[] = [
    /\bsk-[A-Za-z0-9_-]{16,}\b/g,                 // OpenAI / Anthropic style keys
    /\bAKIA[0-9A-Z]{16}\b/g,                       // AWS access key id
    /\bgh[pos]_[A-Za-z0-9]{20,}\b/g,              // GitHub tokens (ghp_/gho_/ghs_/...)
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,          // Slack tokens
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, // JWTs
];

/** `Bearer <token>` — keep the scheme, drop the token. */
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/**
 * `SOMETHING_SECRET=value` / `API_TOKEN: value` env-style lines — keep the key,
 * mask the value. Key must look credential-ish to avoid masking benign config.
 */
const ENV_ASSIGNMENT =
    /\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|API|CREDENTIAL|AUTH)[A-Z0-9_]*)\s*([=:])\s*(['"]?)([^\s'"]{6,})\3/g;

/** Redact known secrets in a single string. */
export function redactString(text: string): string {
    let out = text;
    for (const re of SECRET_PATTERNS) out = out.replace(re, PLACEHOLDER);
    out = out.replace(BEARER, (_m, scheme) => `${scheme} ${PLACEHOLDER}`);
    out = out.replace(ENV_ASSIGNMENT, (_m, key, sep) => `${key}${sep}${PLACEHOLDER}`);
    return out;
}

/**
 * Redact secrets anywhere in an arbitrary value (string, or nested
 * object/array of strings), preserving structure. Non-string leaves pass
 * through untouched. Bounded depth so a pathological/circular structure can't
 * spin — beyond the cap the value is returned as-is.
 */
export function redactSecrets<T>(value: T, depth = 6): T {
    if (typeof value === 'string') return redactString(value) as unknown as T;
    if (depth <= 0 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        return value.map((v) => redactSecrets(v, depth - 1)) as unknown as T;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = redactSecrets(v, depth - 1);
    }
    return out as unknown as T;
}
