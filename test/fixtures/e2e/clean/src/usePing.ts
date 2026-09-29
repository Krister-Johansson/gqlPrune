// Fixture source file; parsed by gqlPrune, never compiled.
import { useGetPingQuery } from './hooks';

export function usePing() {
  const { data } = useGetPingQuery();
  return data?.ping ?? null;
}
