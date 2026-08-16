// FIXTURE source file; string-searched only, never compiled.
import { useGetLedgerQuery } from './hooks';

export function useLedger() {
  const { data } = useGetLedgerQuery();
  return data?.ledger ?? null;
}

export const RETIRED_EVENTS = ['GetArchivedLedger'];
