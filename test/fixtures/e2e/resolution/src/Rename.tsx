// FIXTURE source file; parsed by gqlPrune, never compiled. Imports that point at ./generated resolve to nothing on purpose, the way an excluded codegen directory does.
import { useQuery } from '@apollo/client';
import { GetViaRenameDocument as Doc } from './generated/graphql';

export const Rename = () => useQuery(Doc);
