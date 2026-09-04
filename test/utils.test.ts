// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import {
  capitalizeFirstLetter,
  escapeRegExp,
  pluralize,
  wholeWordPattern,
} from '../src/utils/stringHelpers';

describe('capitalizeFirstLetter', () => {
  it('should capitalize the first letter of a string', () => {
    expect(capitalizeFirstLetter('hello')).toBe('Hello');
    expect(capitalizeFirstLetter('World')).toBe('World');
    expect(capitalizeFirstLetter('')).toBe('');
  });
});

describe('pluralize', () => {
  it('keeps the singular for exactly one', () => {
    expect(pluralize(1, 'file')).toBe('file');
  });

  it('adds an s for every other count, zero included', () => {
    expect(pluralize(0, 'file')).toBe('files');
    expect(pluralize(2, 'file')).toBe('files');
  });

  it('uses the given plural when adding an s would be wrong', () => {
    expect(pluralize(1, 'it', 'them')).toBe('it');
    expect(pluralize(3, 'it', 'them')).toBe('them');
  });
});

describe('wholeWordPattern', () => {
  it('does not find a name inside a longer identifier', () => {
    // The failure this exists to stop: the built-in {Name}Document pattern
    // expanded for "query User" is a substring of an unrelated GetUserDocument,
    // so a dead operation was silently judged alive.
    expect(wholeWordPattern('UserDocument').test('GetUserDocument')).toBe(
      false,
    );
    expect(wholeWordPattern('GetDocument').test('GetDocumentMetadata')).toBe(
      false,
    );
  });

  it('finds a name standing on its own', () => {
    expect(
      wholeWordPattern('useGetUserQuery').test('const x = useGetUserQuery();'),
    ).toBe(true);
  });

  it('treats $ as part of an identifier, unlike \\b', () => {
    // $User is a different identifier from User, and \b would not say so.
    expect(wholeWordPattern('User').test('$User')).toBe(false);
    expect(wholeWordPattern('User').test('User$')).toBe(false);
  });

  it('treats a non-ASCII identifier character as part of the word', () => {
    // A word boundary is ASCII-only, so it would let UserDocument match inside
    // the perfectly legal identifier below and report a dead operation as used.
    expect(wholeWordPattern('UserDocument').test('\u03C0UserDocument')).toBe(
      false,
    );
    expect(wholeWordPattern('UserDocument').test('UserDocument\u00E9')).toBe(
      false,
    );
    expect(wholeWordPattern('UserDocument').test('{ UserDocument }')).toBe(
      true,
    );
  });

  it('asserts a boundary only where the pattern itself ends in a word', () => {
    // A custom pattern can end in punctuation; demanding a non-word character
    // after a parenthesis would be asserting something about the code that has
    // nothing to do with the name.
    expect(wholeWordPattern('graphql(GetUser)').test('graphql(GetUser)')).toBe(
      true,
    );
    expect(wholeWordPattern('graphql(GetUser)').test('xgraphql(GetUser)')).toBe(
      false,
    );
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
  });

  it('leaves a plain GraphQL name untouched', () => {
    expect(escapeRegExp('avatarUrl')).toBe('avatarUrl');
  });
});
