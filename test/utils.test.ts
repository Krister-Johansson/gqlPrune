import { capitalizeFirstLetter } from '../src/utils/stringHelpers';

describe('capitalizeFirstLetter', () => {
  it('should capitalize the first letter of a string', () => {
    expect(capitalizeFirstLetter('hello')).toBe('Hello');
    expect(capitalizeFirstLetter('World')).toBe('World');
    expect(capitalizeFirstLetter('')).toBe('');
  });
});
