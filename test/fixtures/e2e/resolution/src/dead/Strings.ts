// FIXTURE source file; parsed by gqlPrune, never compiled. Imports that point at ./generated resolve to nothing on purpose, the way an excluded codegen directory does.
// A pattern inside a string is not a reference and, being the expanded
// pattern rather than the bare name, not even a mention: the finding grades high.
export const RETIRED = ['useGetPatternInStringQuery'];
// The bare name inside a string is a mention: the finding grades low.
export const EVENT = { name: 'GetNameInString' };
