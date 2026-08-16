// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import {
  capConfidence,
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
import { SourceFile } from '../src/utils/fileUtils';
import { OperationInfo } from '../src/types/OperationInfo';

const source = (content: string, file = 'src/App.tsx'): SourceFile => ({
  file,
  content,
});

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
  it('grades a name that appears nowhere as high', () => {
    expect(
      gradeName('GetUser', [source('useSomethingElse()')], new Set()),
    ).toEqual({ confidence: 'high', reason: 'name-absent' });
  });

  it('grades a name that appears only in a generated file as medium', () => {
    const sources = [
      source(
        'export const GetUserDocument = gql`query GetUser { id }`;',
        'src/gql/graphql.ts',
      ),
      source('const x = 1', 'src/App.tsx'),
    ];
    expect(
      gradeName('GetUser', sources, new Set(['src/gql/graphql.ts'])),
    ).toEqual({ confidence: 'medium', reason: 'generated-only' });
  });

  it('grades a name that appears in ordinary source as low', () => {
    const sources = [
      source(
        'export const GetUserDocument = gql`query GetUser { id }`;',
        'src/gql/graphql.ts',
      ),
      source('registry["GetUser"]()', 'src/App.tsx'),
    ];
    expect(
      gradeName('GetUser', sources, new Set(['src/gql/graphql.ts'])),
    ).toEqual({ confidence: 'low', reason: 'source-mention' });
  });

  it('matches whole words only', () => {
    expect(
      gradeName('User', [source('const p = UserProfile')], new Set()),
    ).toEqual({ confidence: 'high', reason: 'name-absent' });
    expect(
      gradeName('User', [source('const p = { User }')], new Set()),
    ).toEqual({ confidence: 'low', reason: 'source-mention' });
  });

  it('is case-sensitive', () => {
    expect(gradeName('GetUser', [source('getuser()')], new Set())).toEqual({
      confidence: 'high',
      reason: 'name-absent',
    });
  });

  it('treats an empty corpus as no trace of the name', () => {
    expect(gradeName('GetUser', [], new Set())).toEqual({
      confidence: 'high',
      reason: 'name-absent',
    });
  });
});

describe('capConfidence', () => {
  it('leaves a grade already at or below the cap alone', () => {
    expect(
      capConfidence({ confidence: 'low', reason: 'source-mention' }, 'medium'),
    ).toEqual({ confidence: 'low', reason: 'source-mention' });
    expect(
      capConfidence(
        { confidence: 'medium', reason: 'generated-only' },
        'medium',
      ),
    ).toEqual({ confidence: 'medium', reason: 'generated-only' });
  });

  it('lowers a stronger grade to the cap and says why', () => {
    expect(
      capConfidence({ confidence: 'high', reason: 'name-absent' }, 'medium'),
    ).toEqual({ confidence: 'medium', reason: 'heuristic-cap' });
  });
});

describe('lowestConfidence', () => {
  it('returns the weakest grade of the set', () => {
    expect(
      lowestConfidence([
        { confidence: 'high', reason: 'name-absent' },
        { confidence: 'low', reason: 'source-mention' },
        { confidence: 'medium', reason: 'generated-only' },
      ]),
    ).toEqual({ confidence: 'low', reason: 'source-mention' });
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
      reason: 'source-mention' as const,
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
        { confidence: 'low', reason: 'source-mention' },
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
      'source-mention',
      'heuristic-cap',
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
      gradeOperations(
        operations,
        [source('doSomething(Mentioned)')],
        new Set(),
      ),
    ).toEqual([
      { ...operations[0], confidence: 'high', reason: 'name-absent' },
      { ...operations[1], confidence: 'low', reason: 'source-mention' },
    ]);
  });

  it('does not throw without operations or sources', () => {
    expect(gradeOperations([], [], new Set())).toEqual([]);
  });
});

describe('gradeFragments', () => {
  it('grades each fragment by the bare-name search', () => {
    expect(
      gradeFragments(
        [{ name: 'UserFields', filePath: 'g/a.gql', line: 4 }],
        [source('const UserFields = 1', 'src/gql/graphql.ts')],
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
    expect(gradeFragments([], [], new Set())).toEqual([]);
  });
});

describe('gradeFieldCandidates', () => {
  const candidates = [
    { field: 'avatarUrl', locations: [{ file: 'g/a.gql', line: 4 }] },
  ];

  it('never grades a field candidate above medium', () => {
    // The name is absent everywhere, which would be `high` for an operation.
    const [graded] = gradeFieldCandidates(candidates, [source('')], new Set());
    expect(graded.confidence).toBe('medium');
    expect(graded.reason).toBe('heuristic-cap');
    expect(graded.field).toBe('avatarUrl');
    expect(graded.locations).toEqual([{ file: 'g/a.gql', line: 4 }]);
  });

  it('keeps a weaker grade as it is', () => {
    const [graded] = gradeFieldCandidates(
      candidates,
      [source('const key = "avatarUrl"')],
      new Set(),
    );
    expect(graded.confidence).toBe('low');
    expect(graded.reason).toBe('source-mention');
  });

  it('does not throw without candidates or sources', () => {
    expect(gradeFieldCandidates([], [], new Set())).toEqual([]);
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
            reason: 'source-mention',
          },
        ],
      ),
    ).toEqual([
      { file: 'g/dead.gql', confidence: 'low', reason: 'source-mention' },
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
            reason: 'source-mention',
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
