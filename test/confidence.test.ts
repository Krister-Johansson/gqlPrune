// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import {
  countByConfidence,
  CONFIDENCE_LEVELS,
  describeConfidence,
  filterByConfidence,
  gradeFieldCandidates,
  gradeFragments,
  gradeName,
  gradeOperations,
  gradeOrphanedFiles,
  isConfidenceLevel,
  lowestConfidence,
  meetsMinConfidence,
} from '../src/utils/confidence';
import { OperationInfo } from '../src/types/OperationInfo';
import { indexOf } from './support';

/** The index the grader reads: one file unless a second is given. */
const source = (content: string, file = 'src/App.tsx') =>
  indexOf({ [file]: content });

describe('CONFIDENCE_LEVELS', () => {
  it('lists the levels from strongest to weakest', () => {
    expect(CONFIDENCE_LEVELS).toEqual(['high', 'medium', 'low']);
  });
});

describe('isConfidenceLevel', () => {
  it('accepts every level', () => {
    for (const level of CONFIDENCE_LEVELS) {
      expect(isConfidenceLevel(level)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isConfidenceLevel('HIGH')).toBe(false);
    expect(isConfidenceLevel('none')).toBe(false);
    expect(isConfidenceLevel('')).toBe(false);
    expect(isConfidenceLevel(undefined)).toBe(false);
    expect(isConfidenceLevel(3)).toBe(false);
  });
});

describe('gradeName', () => {
  // Grades come from the reference index now: an identifier and a string
  // holding the name are told apart, and a comment is nothing at all.
  it('grades a name that appears nowhere as high', () => {
    expect(
      gradeName('GetUser', source('useSomethingElse()'), new Set()),
    ).toEqual({ confidence: 'high', reason: 'name-absent' });
  });

  it('grades a name that appears only in a generated file as medium', () => {
    const index = indexOf({
      'src/gql/graphql.ts':
        'export const GetUserDocument = gql`query GetUser { id }`;',
      'src/App.tsx': 'const x = 1',
    });
    expect(
      gradeName('GetUser', index, new Set(['src/gql/graphql.ts'])),
    ).toEqual({ confidence: 'medium', reason: 'generated-only' });
  });

  it('grades a name mentioned as a string only in a generated file as medium', () => {
    const index = indexOf({
      'src/gql/graphql.ts': "export const RETIRED = ['GetUser'];",
    });
    expect(
      gradeName('GetUser', index, new Set(['src/gql/graphql.ts'])),
    ).toEqual({ confidence: 'medium', reason: 'generated-only' });
  });

  it('grades a name whose only mention is a string in ordinary source as low', () => {
    const index = indexOf({
      'src/gql/graphql.ts':
        'export const GetUserDocument = gql`query GetUser { id }`;',
      'src/App.tsx': 'registry["GetUser"]()',
    });
    expect(
      gradeName('GetUser', index, new Set(['src/gql/graphql.ts'])),
    ).toEqual({ confidence: 'low', reason: 'string-mention' });
  });

  it('grades a name read as an identifier in ordinary source as low', () => {
    expect(gradeName('GetUser', source('track(GetUser);'), new Set())).toEqual({
      confidence: 'low',
      reason: 'name-referenced',
    });
  });

  it('prefers the identifier reason when both kinds of mention exist', () => {
    expect(
      gradeName('GetUser', source("track(GetUser, 'GetUser');"), new Set()),
    ).toEqual({ confidence: 'low', reason: 'name-referenced' });
  });

  it('does not count the name inside a longer identifier', () => {
    expect(
      gradeName('User', source('const p = UserProfile'), new Set()),
    ).toEqual({ confidence: 'high', reason: 'name-absent' });
    expect(gradeName('User', source('const p = { User }'), new Set())).toEqual({
      confidence: 'low',
      reason: 'name-referenced',
    });
  });

  it('does not count the name in a comment', () => {
    expect(
      gradeName('GetUser', source('// GetUser\n/* GetUser */'), new Set()),
    ).toEqual({ confidence: 'high', reason: 'name-absent' });
  });

  it('is case-sensitive', () => {
    expect(gradeName('GetUser', source('getuser()'), new Set())).toEqual({
      confidence: 'high',
      reason: 'name-absent',
    });
  });

  it('treats an empty corpus as no trace of the name', () => {
    expect(gradeName('GetUser', indexOf({}), new Set())).toEqual({
      confidence: 'high',
      reason: 'name-absent',
    });
  });
});

describe('lowestConfidence', () => {
  it('returns the weakest grade of the set', () => {
    expect(
      lowestConfidence([
        { confidence: 'high', reason: 'name-absent' },
        { confidence: 'low', reason: 'string-mention' },
        { confidence: 'medium', reason: 'generated-only' },
      ]),
    ).toEqual({ confidence: 'low', reason: 'string-mention' });
  });

  it('keeps the single grade when there is only one', () => {
    expect(
      lowestConfidence([{ confidence: 'medium', reason: 'generated-only' }]),
    ).toEqual({ confidence: 'medium', reason: 'generated-only' });
  });

  it('does not throw on an empty set', () => {
    expect(lowestConfidence([])).toEqual({
      confidence: 'high',
      reason: 'name-absent',
    });
  });
});

describe('meetsMinConfidence', () => {
  it('keeps everything when no minimum is set', () => {
    for (const level of CONFIDENCE_LEVELS) {
      expect(meetsMinConfidence(level, undefined)).toBe(true);
    }
  });

  it('keeps a level at or above the minimum', () => {
    expect(meetsMinConfidence('high', 'medium')).toBe(true);
    expect(meetsMinConfidence('medium', 'medium')).toBe(true);
    expect(meetsMinConfidence('low', 'low')).toBe(true);
  });

  it('drops a level below the minimum', () => {
    expect(meetsMinConfidence('medium', 'high')).toBe(false);
    expect(meetsMinConfidence('low', 'high')).toBe(false);
    expect(meetsMinConfidence('low', 'medium')).toBe(false);
  });
});

describe('filterByConfidence', () => {
  const findings = [
    { name: 'A', confidence: 'high' as const, reason: 'name-absent' as const },
    {
      name: 'B',
      confidence: 'medium' as const,
      reason: 'generated-only' as const,
    },
    {
      name: 'C',
      confidence: 'low' as const,
      reason: 'string-mention' as const,
    },
  ];

  it('returns every finding when no minimum is set', () => {
    expect(filterByConfidence(findings, undefined)).toEqual(findings);
  });

  it('keeps only the findings at or above the minimum', () => {
    expect(filterByConfidence(findings, 'medium').map((f) => f.name)).toEqual([
      'A',
      'B',
    ]);
    expect(filterByConfidence(findings, 'high').map((f) => f.name)).toEqual([
      'A',
    ]);
  });

  it('does not throw on an empty list', () => {
    expect(filterByConfidence([], 'high')).toEqual([]);
  });
});

describe('countByConfidence', () => {
  it('counts one bucket per level', () => {
    expect(
      countByConfidence([
        { confidence: 'high', reason: 'name-absent' },
        { confidence: 'high', reason: 'name-absent' },
        { confidence: 'low', reason: 'string-mention' },
      ]),
    ).toEqual({ high: 2, medium: 0, low: 1 });
  });

  it('counts nothing for an empty list', () => {
    expect(countByConfidence([])).toEqual({ high: 0, medium: 0, low: 0 });
  });
});

describe('describeConfidence', () => {
  it('names the level, the reason code, and the evidence', () => {
    expect(
      describeConfidence({ confidence: 'high', reason: 'name-absent' }),
    ).toBe('high (name-absent: the name appears in no scanned source file)');
  });

  it('has wording for every reason it can produce', () => {
    for (const reason of [
      'name-absent',
      'generated-only',
      'name-referenced',
      'string-mention',
      'heuristic-cap',
      'never-read',
    ] as const) {
      expect(describeConfidence({ confidence: 'low', reason })).toContain(
        `(${reason}: `,
      );
    }
  });
});

describe('gradeOperations', () => {
  const operations: OperationInfo[] = [
    { name: 'Gone', type: 'query', filePath: 'g/a.gql' },
    { name: 'Mentioned', type: 'mutation', filePath: 'g/a.gql' },
  ];

  it('grades each operation by the bare-name search', () => {
    expect(
      gradeOperations(operations, source('doSomething(Mentioned)'), new Set()),
    ).toEqual([
      { ...operations[0], confidence: 'high', reason: 'name-absent' },
      { ...operations[1], confidence: 'low', reason: 'name-referenced' },
    ]);
  });

  it('does not throw without operations or sources', () => {
    expect(gradeOperations([], indexOf({}), new Set())).toEqual([]);
  });
});

describe('gradeFragments', () => {
  it('grades each fragment by the bare-name search', () => {
    expect(
      gradeFragments(
        [{ name: 'UserFields', filePath: 'g/a.gql', line: 4 }],
        source('const UserFields = 1', 'src/gql/graphql.ts'),
        new Set(['src/gql/graphql.ts']),
      ),
    ).toEqual([
      {
        name: 'UserFields',
        filePath: 'g/a.gql',
        line: 4,
        confidence: 'medium',
        reason: 'generated-only',
      },
    ]);
  });

  it('does not throw without fragments or sources', () => {
    expect(gradeFragments([], indexOf({}), new Set())).toEqual([]);
  });
});

describe('gradeFieldCandidates', () => {
  const candidates = [
    {
      operation: 'GetUser',
      path: 'user.avatarUrl',
      field: 'avatarUrl',
      locations: [{ file: 'g/a.gql', line: 4 }],
      traced: true,
    },
    {
      operation: 'GetFeed',
      path: 'feed.bio',
      field: 'bio',
      locations: [{ file: 'g/b.gql', line: 2 }],
      traced: false,
    },
  ];

  it('grades a traced candidate high and a name-matched one medium', () => {
    // Every call site of GetUser was followed and none reaches the field. GetFeed
    // had nothing to trace, so its key was only matched by name, which cannot
    // see a read through a rename, a spread or a computed key.
    expect(gradeFieldCandidates(candidates)).toEqual([
      {
        operation: 'GetUser',
        path: 'user.avatarUrl',
        field: 'avatarUrl',
        locations: [{ file: 'g/a.gql', line: 4 }],
        confidence: 'high',
        reason: 'never-read',
      },
      {
        operation: 'GetFeed',
        path: 'feed.bio',
        field: 'bio',
        locations: [{ file: 'g/b.gql', line: 2 }],
        confidence: 'medium',
        reason: 'heuristic-cap',
      },
    ]);
  });

  it('keeps the trace flag out of the graded finding', () => {
    for (const graded of gradeFieldCandidates(candidates)) {
      expect(graded).not.toHaveProperty('traced');
    }
  });

  it('returns [] without candidates', () => {
    expect(gradeFieldCandidates([])).toEqual([]);
  });
});

describe('gradeOrphanedFiles', () => {
  const operation = (name: string, confidence: 'high' | 'medium' | 'low') => ({
    name,
    type: 'query' as const,
    filePath: 'g/dead.gql',
    confidence,
    reason: 'name-absent' as const,
  });

  it('takes the lowest grade among the definitions in the file', () => {
    expect(
      gradeOrphanedFiles(
        ['g/dead.gql'],
        [operation('Gone', 'high')],
        [
          {
            name: 'AlsoGone',
            filePath: 'g/dead.gql',
            confidence: 'low',
            reason: 'string-mention',
          },
        ],
      ),
    ).toEqual([
      { file: 'g/dead.gql', confidence: 'low', reason: 'string-mention' },
    ]);
  });

  it('ignores definitions from other files', () => {
    expect(
      gradeOrphanedFiles(
        ['g/dead.gql'],
        [operation('Gone', 'high')],
        [
          {
            name: 'Elsewhere',
            filePath: 'g/other.gql',
            confidence: 'low',
            reason: 'string-mention',
          },
        ],
      ),
    ).toEqual([
      { file: 'g/dead.gql', confidence: 'high', reason: 'name-absent' },
    ]);
  });

  it('matches definitions whose path is spelled differently', () => {
    expect(
      gradeOrphanedFiles(
        ['g/dead.gql'],
        [{ ...operation('Gone', 'medium'), filePath: './g/dead.gql' }],
        [],
      ),
    ).toEqual([
      { file: 'g/dead.gql', confidence: 'medium', reason: 'name-absent' },
    ]);
  });

  it('does not throw without orphaned files', () => {
    expect(gradeOrphanedFiles([], [], [])).toEqual([]);
  });
});
