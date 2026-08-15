// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import fc from 'fast-check';
import { capitalizeFirstLetter } from '../src/utils/stringHelpers';
import {
  buildUsagePatterns,
  expandPattern,
} from '../src/utils/usagePatterns';
import {
  createExcludeMatcher,
  isOperationUsedInContents,
} from '../src/utils/fileUtils';
import { createConfigExcludeMatcher } from '../src/core/gqlPruner';
import {
  findUnusedFragments,
  findUnusedFragmentsInCorpus,
  reachableFragments,
} from '../src/utils/fragments';
import { OperationInfo } from '../src/types/OperationInfo';
import { FragmentInfo } from '../src/types/FragmentInfo';
import { GraphqlFileEntities } from '../src/utils/operations';

// Property-based tests: instead of hand-picked examples, fast-check generates
// hundreds of inputs per property and asserts invariants that must hold for
// every one of them. Generators stick to GraphQL-identifier-shaped names
// because that is the input space the scanner actually sees.

const lower = 'abcdefghijklmnopqrstuvwxyz';
const alnum = lower + lower.toUpperCase() + '0123456789_';
const charFrom = (chars: string) => fc.constantFrom(...chars.split(''));
const identifierArb = fc
  .tuple(
    charFrom(lower + lower.toUpperCase()),
    fc.array(charFrom(alnum), { maxLength: 12 }),
  )
  .map(([head, tail]) => head + tail.join(''));
const operationArb: fc.Arbitrary<OperationInfo> = fc.record({
  name: identifierArb,
  type: fc.constantFrom<'query' | 'mutation' | 'subscription'>(
    'query',
    'mutation',
    'subscription',
  ),
  filePath: fc.constant('generated.gql'),
});

describe('property-based invariants', () => {
  describe('capitalizeFirstLetter', () => {
    it('is idempotent and only ever touches the first character', () => {
      fc.assert(
        fc.property(fc.string(), (s) => {
          const once = capitalizeFirstLetter(s);
          expect(capitalizeFirstLetter(once)).toBe(once);
          expect(once.slice(1)).toBe(s.slice(1));
        }),
      );
    });
  });

  describe('expandPattern', () => {
    it('leaves no placeholder unexpanded for any operation', () => {
      const patternArb = fc
        .array(
          fc.oneof(
            fc.constantFrom('{name}', '{Name}', '{type}', '{Type}'),
            identifierArb,
          ),
          { maxLength: 6 },
        )
        .map((parts) => parts.join(''));
      fc.assert(
        fc.property(patternArb, operationArb, (pattern, op) => {
          const expanded = expandPattern(pattern, op);
          for (const token of ['{name}', '{Name}', '{type}', '{Type}']) {
            expect(expanded).not.toContain(token);
          }
        }),
      );
    });

    it('substitutes each placeholder with exactly the documented value', () => {
      fc.assert(
        fc.property(operationArb, (op) => {
          expect(expandPattern('{name}', op)).toBe(op.name);
          expect(expandPattern('{Name}', op)).toBe(
            capitalizeFirstLetter(op.name),
          );
          expect(expandPattern('{type}', op)).toBe(op.type);
          expect(expandPattern('{Type}', op)).toBe(
            capitalizeFirstLetter(op.type),
          );
        }),
      );
    });
  });

  describe('buildUsagePatterns', () => {
    it('returns a de-duplicated expansion of the given templates', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string(), { maxLength: 8 }),
          operationArb,
          (patterns, op) => {
            const built = buildUsagePatterns(op, patterns);
            expect(new Set(built).size).toBe(built.length);
            expect(built.length).toBeLessThanOrEqual(patterns.length);
            for (const entry of built) {
              expect(patterns.map((p) => expandPattern(p, op))).toContain(
                entry,
              );
            }
          },
        ),
      );
    });
  });

  describe('createExcludeMatcher', () => {
    const segmentsArb = fc.array(identifierArb, { minLength: 0, maxLength: 4 });

    it('never excludes anything when no positive patterns are given', () => {
      fc.assert(
        fc.property(
          fc.array(
            identifierArb.map((p) => `!${p}`),
            { maxLength: 4 },
          ),
          segmentsArb,
          identifierArb,
          (negativesOnly, dirs, name) => {
            const matcher = createExcludeMatcher(negativesOnly);
            expect(matcher([...dirs, name].join('/'))).toBe(false);
          },
        ),
      );
    });

    it('matches a bare name at any depth (gitignore basename semantics)', () => {
      fc.assert(
        fc.property(identifierArb, segmentsArb, (name, dirs) => {
          const matcher = createExcludeMatcher([name]);
          expect(matcher([...dirs, name].join('/'))).toBe(true);
        }),
      );
    });

    it('a matching re-include always wins over its own positive pattern', () => {
      fc.assert(
        fc.property(identifierArb, segmentsArb, (name, dirs) => {
          const matcher = createExcludeMatcher([name, `!${name}`]);
          expect(matcher([...dirs, name].join('/'))).toBe(false);
        }),
      );
    });
  });

  describe('createConfigExcludeMatcher', () => {
    it('always excludes node_modules and .git, whatever the config says', () => {
      const excludeArb = fc.array(
        fc.oneof(
          identifierArb,
          fc.constantFrom('!node_modules', '!.git', '!**', '**'),
        ),
        { maxLength: 6 },
      );
      fc.assert(
        fc.property(
          excludeArb,
          fc.array(identifierArb, { maxLength: 3 }),
          (exclude, dirs) => {
            const matcher = createConfigExcludeMatcher({
              graphqlDir: './graphql',
              srcDir: './src',
              exclude,
            });
            for (const guarded of ['node_modules', '.git']) {
              expect(matcher([...dirs, guarded].join('/'))).toBe(true);
            }
          },
        ),
      );
    });
  });

  describe('isOperationUsedInContents', () => {
    it('finds a pattern wherever it is embedded, and only then', () => {
      fc.assert(
        fc.property(
          identifierArb,
          fc.string(),
          fc.string(),
          fc.array(fc.string(), { maxLength: 4 }),
          (pattern, before, after, otherContents) => {
            const embedded = `${before}${pattern}${after}`;
            expect(
              isOperationUsedInContents(
                [pattern],
                [...otherContents, embedded],
              ),
            ).toBe(true);
            const without = otherContents.filter(
              (content) => !content.includes(pattern),
            );
            expect(isOperationUsedInContents([pattern], without)).toBe(false);
          },
        ),
      );
    });
  });

  describe('fragment reachability', () => {
    // A random spread graph: unique fragment names, arbitrary directed edges
    // between them (cycles included), and an arbitrary subset used as roots.
    const graphArb = fc
      .uniqueArray(identifierArb, { minLength: 1, maxLength: 8 })
      .chain((names) =>
        fc.record({
          names: fc.constant(names),
          roots: fc.subarray(names),
          edges: fc.array(
            fc.tuple(fc.constantFrom(...names), fc.constantFrom(...names)),
            { maxLength: 16 },
          ),
        }),
      );
    const toSpreadMap = (edges: [string, string][]) => {
      const spreads = new Map<string, string[]>();
      for (const [from, to] of edges) {
        spreads.set(from, [...(spreads.get(from) ?? []), to]);
      }
      return spreads;
    };
    const toFragments = (names: string[]): FragmentInfo[] =>
      names.map((name) => ({ name, filePath: 'generated.gql' }));

    it('partitions every fragment into reachable or unused, never both', () => {
      fc.assert(
        fc.property(graphArb, ({ names, roots, edges }) => {
          const spreads = toSpreadMap(edges);
          const reachable = reachableFragments(roots, spreads);
          const unused = findUnusedFragments(
            toFragments(names),
            roots,
            spreads,
          );
          for (const name of names) {
            expect(reachable.has(name)).toBe(
              !unused.some((fragment) => fragment.name === name),
            );
          }
          for (const root of roots) {
            expect(unused.some((fragment) => fragment.name === root)).toBe(
              false,
            );
          }
        }),
      );
    });

    it('adding a spread edge never makes more fragments unused', () => {
      fc.assert(
        fc.property(
          graphArb,
          fc.nat(),
          fc.nat(),
          ({ names, roots, edges }, fromIdx, toIdx) => {
            const extra: [string, string] = [
              names[fromIdx % names.length],
              names[toIdx % names.length],
            ];
            const before = new Set(
              findUnusedFragments(
                toFragments(names),
                roots,
                toSpreadMap(edges),
              ).map((fragment) => fragment.name),
            );
            const after = findUnusedFragments(
              toFragments(names),
              roots,
              toSpreadMap([...edges, extra]),
            );
            for (const fragment of after) {
              expect(before.has(fragment.name)).toBe(true);
            }
          },
        ),
      );
    });
  });

  describe('findUnusedFragmentsInCorpus', () => {
    it('never reports a fragment whose FragmentDoc appears in source', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(identifierArb, { minLength: 1, maxLength: 6 }),
          fc.nat(),
          (names, pick) => {
            const referenced = names[pick % names.length];
            const parsed: GraphqlFileEntities[] = [
              {
                operations: [],
                fragments: names.map((name) => ({
                  name,
                  filePath: 'generated.gql',
                })),
                operationSpreads: [],
                fragmentSpreads: [],
              },
            ];
            const contents = [
              `import { ${capitalizeFirstLetter(referenced)}FragmentDoc } from './gql';`,
            ];
            const unused = findUnusedFragmentsInCorpus(parsed, contents);
            expect(
              unused.some((fragment) => fragment.name === referenced),
            ).toBe(false);
          },
        ),
      );
    });
  });
});
