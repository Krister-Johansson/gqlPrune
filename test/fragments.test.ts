import * as fs from 'fs';
import {
  findUnusedFragments,
  findUnusedFragmentsInCorpus,
  reachableFragments,
} from '../src/utils/fragments';
import { FragmentInfo } from '../src/types/FragmentInfo';

jest.mock('fs');

let originalConsoleError: typeof console.error;
beforeAll(() => {
  originalConsoleError = console.error;
  console.error = jest.fn();
});
afterAll(() => {
  console.error = originalConsoleError;
});

const frag = (name: string, filePath = 'x.gql'): FragmentInfo => ({
  name,
  filePath,
});

describe('fragments', () => {
  describe('reachableFragments', () => {
    const graph = new Map<string, string[]>([
      ['A', ['B']],
      ['B', ['C']],
      ['C', []],
      ['D', ['E']],
      ['E', ['D']], // cycle
    ]);

    it('reaches direct and transitive fragments from a root', () => {
      expect([...reachableFragments(['A'], graph)].sort()).toEqual([
        'A',
        'B',
        'C',
      ]);
    });

    it('supports multiple roots', () => {
      expect([...reachableFragments(['A', 'D'], graph)].sort()).toEqual([
        'A',
        'B',
        'C',
        'D',
        'E',
      ]);
    });

    it('terminates on cycles', () => {
      expect([...reachableFragments(['D'], graph)].sort()).toEqual(['D', 'E']);
    });

    it('returns empty for no roots', () => {
      expect(reachableFragments([], graph).size).toBe(0);
    });

    it('handles a root with no graph entry (dangling spread) safely', () => {
      expect([...reachableFragments(['Ghost'], graph)]).toEqual(['Ghost']);
    });
  });

  describe('findUnusedFragments', () => {
    const all = [frag('A'), frag('B'), frag('C'), frag('Orphan')];
    const graph = new Map<string, string[]>([
      ['A', ['B']],
      ['B', ['C']],
      ['C', []],
      ['Orphan', []],
    ]);

    it('returns fragments not reachable from the roots', () => {
      expect(findUnusedFragments(all, ['A'], graph)).toEqual([frag('Orphan')]);
    });

    it('returns all fragments when there are no roots', () => {
      expect(findUnusedFragments(all, [], graph)).toEqual(all);
    });

    it('returns none when every fragment is reachable', () => {
      expect(findUnusedFragments(all, ['A', 'Orphan'], graph)).toEqual([]);
    });
  });

  describe('findUnusedFragmentsInCorpus', () => {
    afterEach(() => jest.resetAllMocks());

    it('flags a fragment no operation spreads and no source references', () => {
      (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
        if (p === 'ops.gql') return 'query Q { ...Used }';
        return 'fragment Used on T { id }\nfragment Dead on T { id }';
      });
      const unused = findUnusedFragmentsInCorpus(
        ['ops.gql', 'frags.gql'],
        [],
        ['{Name}FragmentDoc'],
      );
      expect(unused.map((f) => f.name)).toEqual(['Dead']);
    });

    it('treats a fragment referenced in source (masking) as used', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'fragment Masked on T { id }',
      );
      const unused = findUnusedFragmentsInCorpus(
        ['f.gql'],
        ['const x = MaskedFragmentDoc;'],
        ['{Name}FragmentDoc'],
      );
      expect(unused).toEqual([]);
    });

    it('follows transitive spreads (fragment used only by a used fragment)', () => {
      (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
        if (p === 'ops.gql') return 'query Q { ...Outer }';
        return 'fragment Outer on T { ...Inner }\nfragment Inner on T { id }\nfragment Lonely on T { id }';
      });
      const unused = findUnusedFragmentsInCorpus(
        ['ops.gql', 'frags.gql'],
        [],
        ['{Name}FragmentDoc'],
      );
      expect(unused.map((f) => f.name)).toEqual(['Lonely']);
    });

    it('returns [] when there are no fragments', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('query Q { id }');
      expect(findUnusedFragmentsInCorpus(['ops.gql'], [], [])).toEqual([]);
    });
  });
});
