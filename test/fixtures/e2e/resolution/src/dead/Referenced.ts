// FIXTURE source file; parsed by gqlPrune, never compiled. Imports that point at ./generated resolve to nothing on purpose, the way an excluded codegen directory does.
// The bare name read as an identifier nothing declares: not a usage pattern,
// but a reference, so the finding grades low with the name-referenced reason.
declare const track: (x: unknown) => void;
export const record = () => track(GetNameReferenced);
