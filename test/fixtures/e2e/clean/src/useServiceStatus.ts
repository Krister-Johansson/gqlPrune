// Fixture source file; parsed by gqlPrune, never compiled.
import { useGetServiceStatusQuery } from './hooks';

export function useServiceStatus() {
  const { data } = useGetServiceStatusQuery();
  return data?.serviceStatus ?? null;
}
