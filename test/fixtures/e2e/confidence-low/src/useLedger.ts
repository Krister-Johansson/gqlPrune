// FIXTURE source file; parsed by gqlPrune, never compiled.
import { useGetLedgerQuery } from './hooks';

export function useLedger() {
  const { data } = useGetLedgerQuery();
  return data?.ledger ?? null;
}

// The dead operation's bare name, read as an identifier that nothing declares:
// a registry lookup by name, say. Not a usage pattern, but a reference, which
// is what grades the finding "low" with the name-referenced reason.
declare const track: (event: unknown) => void;
export const recordArchive = () => track(GetArchivedLedger);
