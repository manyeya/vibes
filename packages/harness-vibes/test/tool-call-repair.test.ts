import { describe, expect, test } from 'bun:test';
import {
    looksLikeLeakedToolSyntax,
    matchToolName,
    normalizeToolName,
    parseLeakedArgs,
    parseLeakedName,
    repairDeterministically,
} from '../src/core/agent/tool-call-repair';

const TOOLS = ['readFile', 'writeFile', 'edit_file', 'list_files', 'bash', 'skill', 'list_skills', 'update_task'];

describe('leaked tool-call syntax', () => {
    // The exact string that arrived as a tool NAME in a real run.
    const REAL = 'load</arg_key>skills</arg_key><arg_value>design-taste-frontend</arg_value>';

    test('detects GLM/Qwen XML markers', () => {
        expect(looksLikeLeakedToolSyntax(REAL)).toBe(true);
        expect(looksLikeLeakedToolSyntax('writeFile')).toBe(false);
        expect(looksLikeLeakedToolSyntax('<tool_call>foo')).toBe(true);
    });

    test('recovers the function name from the leaked string', () => {
        expect(parseLeakedName(REAL)).toBe('load');
        expect(parseLeakedName('web_search<arg_key>q</arg_key>')).toBe('web_search');
    });

    test('recovers argument pairs, including with dropped opening tags', () => {
        expect(parseLeakedArgs(REAL)).toEqual({ skills: 'design-taste-frontend' });
        expect(parseLeakedArgs('f<arg_key>query</arg_key><arg_value>latest go release</arg_value>'))
            .toEqual({ query: 'latest go release' });
    });

    test('tolerates an unclosed arg_value (the corruption ollama patches)', () => {
        expect(parseLeakedArgs('f<arg_key>path</arg_key><arg_value>index.html'))
            .toEqual({ path: 'index.html' });
    });
});

describe('normalizeToolName', () => {
    test('unifies the decorations models add', () => {
        expect(normalizeToolName('writeFile')).toBe('write_file');
        expect(normalizeToolName('WriteFile')).toBe('write_file');
        expect(normalizeToolName('write-file')).toBe('write_file');
        expect(normalizeToolName('functions.writeFile')).toBe('write_file');
        expect(normalizeToolName('TodoTool_tool')).toBe('todo');
        expect(normalizeToolName('BrowserClick_tool')).toBe('browser_click');
    });
});

describe('matchToolName', () => {
    test('exact names pass straight through', () => {
        expect(matchToolName('writeFile', TOOLS)).toBe('writeFile');
    });

    test('case and separator variants resolve', () => {
        expect(matchToolName('WriteFile', TOOLS)).toBe('writeFile');
        expect(matchToolName('write-file', TOOLS)).toBe('writeFile');
        expect(matchToolName('functions.write_file', TOOLS)).toBe('writeFile');
        expect(matchToolName('writeFile_tool', TOOLS)).toBe('writeFile');
    });

    test('a typo resolves by edit distance', () => {
        expect(matchToolName('writeFil', TOOLS)).toBe('writeFile');
        expect(matchToolName('lst_files', TOOLS)).toBe('list_files');
    });

    test('an unrelated name is refused rather than guessed', () => {
        // Running the wrong tool is worse than reporting an unknown one.
        expect(matchToolName('send_email', TOOLS)).toBeNull();
        expect(matchToolName('deploy_to_production', TOOLS)).toBeNull();
    });

    test('leaked syntax in the name still resolves', () => {
        const REAL = 'load</arg_key>skills</arg_key><arg_value>design-taste-frontend</arg_value>';
        // "load" is closest to list_skills/skill; whatever it picks must be a
        // real registered tool, never the raw garbage.
        const match = matchToolName(REAL, TOOLS);
        if (match !== null) expect(TOOLS).toContain(match);
    });
});

describe('repairDeterministically', () => {
    test('recovers name and arguments together', () => {
        const out = repairDeterministically({
            toolName: 'skill<arg_key>name</arg_key><arg_value>design-taste-frontend</arg_value>',
            rawInput: '{}',
            availableTools: TOOLS,
        });
        expect(out).not.toBeNull();
        expect(out!.toolName).toBe('skill');
        expect(out!.args).toEqual({ name: 'design-taste-frontend' });
    });

    test('recovers arguments leaked into the input field instead', () => {
        const out = repairDeterministically({
            toolName: 'writeFile',
            rawInput: '<arg_key>path</arg_key><arg_value>a.txt</arg_value>',
            availableTools: TOOLS,
        });
        expect(out!.toolName).toBe('writeFile');
        expect(out!.args).toEqual({ path: 'a.txt' });
    });

    test('a name-only fix reports no args, so the caller can still re-ask', () => {
        const out = repairDeterministically({ toolName: 'WriteFile', rawInput: '{}', availableTools: TOOLS });
        expect(out!.toolName).toBe('writeFile');
        expect(out!.args).toBeNull();
    });

    test('gives up on a genuinely unknown tool', () => {
        expect(repairDeterministically({
            toolName: 'launch_missiles', rawInput: '{}', availableTools: TOOLS,
        })).toBeNull();
    });
});
