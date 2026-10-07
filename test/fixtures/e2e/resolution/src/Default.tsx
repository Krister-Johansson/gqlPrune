// FIXTURE source file; parsed by gqlPrune, never compiled. Imports that point at ./generated resolve to nothing on purpose, the way an excluded codegen directory does.
import { useQuery } from '@apollo/client';
import userDoc from './api/userDoc';

export const Default = () => useQuery(userDoc);
