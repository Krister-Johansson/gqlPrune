// FIXTURE source file; gqlPrune parses it. It is
// never compiled, typechecked or linted, and the import resolves to nothing.
import { useGetNotesQuery } from './hooks';

export function useNotes() {
  const { data } = useGetNotesQuery();
  return data?.note ?? null;
}
