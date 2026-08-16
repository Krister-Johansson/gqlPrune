// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { capitalizeFirstLetter, pluralize } from '../src/utils/stringHelpers';

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
