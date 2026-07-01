import { describe, expect, test } from 'bun:test';
import { matchSkills, type SkillInfo } from '../src/plugins/skills';

const skills: SkillInfo[] = [
    { name: 'csv-parser', description: 'Parse and transform CSV files' },
    { name: 'git-commit', description: 'Create logical git commits from a working tree' },
    { name: 'pdf-export', description: 'Export a document to PDF' },
];

describe('matchSkills', () => {
    test('finds by name', () => {
        expect(matchSkills(skills, 'csv').map(s => s.name)).toEqual(['csv-parser']);
    });

    test('finds by description keyword', () => {
        expect(matchSkills(skills, 'working tree').map(s => s.name)).toContain('git-commit');
    });

    test('ranks a name hit above a description-only hit', () => {
        const s: SkillInfo[] = [
            { name: 'notes', description: 'mentions git in passing' },
            { name: 'git-commit', description: 'commit helper' },
        ];
        // "git" hits git-commit's NAME (score 2) and notes' DESCRIPTION (score 1).
        expect(matchSkills(s, 'git').map(x => x.name)).toEqual(['git-commit', 'notes']);
    });

    test('empty query returns the full catalog', () => {
        expect(matchSkills(skills, '   ').length).toBe(3);
    });

    test('no match returns []', () => {
        expect(matchSkills(skills, 'kubernetes')).toEqual([]);
    });
});
