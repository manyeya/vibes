/**
 * Deterministic repair for malformed tool calls — no model call.
 *
 * Models emit tool calls in whatever format they were trained on, and the
 * serving stack has to translate that into OpenAI-style JSON. When the two
 * disagree the call arrives mangled, and the failure is not the model being
 * stupid — it is a format mismatch with recoverable intent.
 *
 * Two real examples from one run, on two different backends:
 *
 *   toolName: "load</arg_key>skills</arg_key><arg_value>design-taste-frontend</arg_value>"
 *   input:    {}
 *
 * That is the GLM / Qwen3-Coder XML tool-call syntax
 * (`func<arg_key>k</arg_key><arg_value>v</arg_value>`) leaking through a parser
 * that expected JSON. The name and the arguments are both right there.
 *
 * The AI SDK's own docs say not to repair `NoSuchToolError` ("do not attempt to
 * fix invalid tool names"), which assumes the model hallucinated a tool. That
 * holds for hallucination and not for this: ollama, Hermes and Kilocode all
 * repair names for exactly this reason. We try to recover, and only give up
 * when nothing plausibly matches.
 *
 * Deterministic first, model re-ask second — this is cheaper, faster and more
 * predictable than paying for a round trip to guess what `writeFile` meant.
 */

/** Markers that mean a model's native tool-call syntax leaked through raw. */
const XML_MARKERS = ['<arg_key>', '<arg_value>', '</arg_key>', '</arg_value>', '<tool_call>', '<function='];

export function looksLikeLeakedToolSyntax(text: string): boolean {
    return XML_MARKERS.some((m) => text.includes(m));
}

/**
 * Pull `{k: v}` out of GLM-style `<arg_key>k</arg_key><arg_value>v</arg_value>`
 * pairs. Tolerates missing opening tags, which is the common corruption (ollama
 * carries a patch for unclosed `arg_value` tags for the same reason).
 */
export function parseLeakedArgs(text: string): Record<string, string> {
    const args: Record<string, string> = {};
    // Drop the leading function name: in `func<arg_key>k</arg_key>…` it sits
    // before the first tag and would otherwise be read as the first key.
    const firstTag = text.indexOf('<');
    const body = firstTag >= 0 ? text.slice(firstTag) : text;

    // Keys and values are matched independently and zipped from the END, so a
    // dropped opening tag (the common corruption) loses at most one pair rather
    // than shifting every pairing after it.
    const keys = [...body.matchAll(/(?:<arg_key>)?([^<>]+?)<\/arg_key>/g)].map((m) => m[1].trim()).filter(Boolean);
    const values = [...body.matchAll(/<arg_value>([\s\S]*?)(?:<\/arg_value>|$)/g)].map((m) => m[1].trim());
    const n = Math.min(keys.length, values.length);
    for (let i = 0; i < n; i++) {
        args[keys[keys.length - n + i]] = values[values.length - n + i];
    }
    return args;
}

/** The function name is whatever precedes the first tag. */
export function parseLeakedName(text: string): string {
    const head = text.split('<')[0].trim();
    return head || text.trim();
}

/**
 * Canonical form for comparing names: lowercase, separators unified,
 * camelCase split, and the `_tool` / `functions.` decorations some models add.
 */
export function normalizeToolName(name: string): string {
    let out = name
        .replace(/^functions?\./i, '')          // OpenAI-style namespacing
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2') // camelCase → camel_case
        .toLowerCase()
        .replace(/[-\s.]+/g, '_');
    // Repeat: "TodoTool_tool" normalizes to todo_tool_tool and needs two passes.
    let prev: string;
    do {
        prev = out;
        out = out.replace(/_?tools?$/, '');
    } while (out !== prev && out.length > 0);
    return out.replace(/^_+|_+$/g, '');
}

/** Normalized edit distance, 0 (identical) → 1 (nothing in common). */
function distance(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length || !b.length) return 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        prev = cur;
    }
    return prev[b.length] / Math.max(a.length, b.length);
}

/**
 * Best match for a mangled name among the registered tools, or null.
 *
 * Exact → normalized → containment → fuzzy. The fuzzy threshold is deliberately
 * tight: silently running the *wrong* tool is far worse than reporting an
 * unknown one, so anything less than a close match is refused.
 */
export function matchToolName(raw: string, available: string[]): string | null {
    if (available.includes(raw)) return raw;

    const candidate = normalizeToolName(looksLikeLeakedToolSyntax(raw) ? parseLeakedName(raw) : raw);
    if (!candidate) return null;

    const normalized = new Map(available.map((t) => [normalizeToolName(t), t]));
    const exact = normalized.get(candidate);
    if (exact) return exact;

    // Containment, longest first so `list_skills` beats `skill` for "list_skills_x".
    const contains = [...normalized.entries()]
        .filter(([n]) => n.includes(candidate) || candidate.includes(n))
        .sort((a, b) => b[0].length - a[0].length);
    if (contains.length) return contains[0][1];

    let best: { tool: string; d: number } | null = null;
    for (const [n, tool] of normalized) {
        const d = distance(candidate, n);
        if (!best || d < best.d) best = { tool, d };
    }
    return best && best.d <= 0.34 ? best.tool : null;
}

export interface RepairedCall {
    toolName: string;
    /** Arguments recovered from the leaked syntax, if any were present. */
    args: Record<string, string> | null;
}

/**
 * Try to recover a usable call from a mangled name and/or arguments, using no
 * model call. Returns null when nothing plausible was found.
 */
export function repairDeterministically(opts: {
    toolName: string;
    rawInput: string;
    availableTools: string[];
}): RepairedCall | null {
    const { toolName, rawInput, availableTools } = opts;

    // The leaked syntax can land in either field depending on where the
    // provider's parser gave up, so look in both.
    const leaked = [toolName, rawInput].find(looksLikeLeakedToolSyntax);
    const matched = matchToolName(toolName, availableTools);
    if (!matched) return null;

    const args = leaked ? parseLeakedArgs(leaked) : null;
    return { toolName: matched, args: args && Object.keys(args).length ? args : null };
}
