// Fixture source file; string-searched only, never compiled.
import { useGetPingQuery } from './hooks';

export function usePing() {
  const { data } = useGetPingQuery();
  return data?.ping ?? null;
}
