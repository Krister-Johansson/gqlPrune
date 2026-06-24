import {
  DEFAULT_USAGE_PATTERNS,
  buildFragmentPatterns,
  buildUsagePatterns,
  expandPattern,
} from '../src/utils/usagePatterns';
import { OperationInfo } from '../src/types/OperationInfo';

const op: OperationInfo = {
  name: 'getUser',
  type: 'query',
  filePath: 'getUser.gql',
};

describe('usagePatterns', () => {
  describe('expandPattern', () => {
    it('should substitute name and type placeholders (both casings)', () => {
      expect(expandPattern('use{Name}{Type}', op)).toBe('useGetUserQuery');
      expect(expandPattern('{name}.{type}', op)).toBe('getUser.query');
      expect(expandPattern('{Name}Document', op)).toBe('GetUserDocument');
    });
  });

  describe('buildUsagePatterns', () => {
    it('should expand all default patterns for an operation', () => {
      expect(buildUsagePatterns(op)).toEqual([
        'useGetUserQuery',
        'useGetUserLazyQuery',
        'useGetUserSuspenseQuery',
        'GetUserDocument',
      ]);
    });

    it('should support custom patterns', () => {
      expect(buildUsagePatterns(op, ['{Name}', '{name}_{type}'])).toEqual([
        'GetUser',
        'getUser_query',
      ]);
    });

    it('should de-duplicate expanded patterns', () => {
      expect(buildUsagePatterns(op, ['{Name}', '{Name}'])).toEqual(['GetUser']);
    });

    it('should default to DEFAULT_USAGE_PATTERNS', () => {
      expect(buildUsagePatterns(op)).toEqual(
        buildUsagePatterns(op, DEFAULT_USAGE_PATTERNS),
      );
    });
  });

  describe('buildFragmentPatterns', () => {
    it('expands {Name} and {name} placeholders', () => {
      expect(
        buildFragmentPatterns('userFields', ['{Name}FragmentDoc', '{name}']),
      ).toEqual(['UserFieldsFragmentDoc', 'userFields']);
    });

    it('defaults to {Name}FragmentDoc', () => {
      expect(buildFragmentPatterns('userFields')).toEqual([
        'UserFieldsFragmentDoc',
      ]);
    });

    it('de-duplicates expanded patterns', () => {
      expect(buildFragmentPatterns('x', ['{Name}', '{Name}'])).toEqual(['X']);
    });
  });
});
