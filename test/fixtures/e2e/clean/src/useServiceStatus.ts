// Fixture source file; string-searched only, never compiled.
import { useGetServiceStatusQuery } from './hooks';

export function useServiceStatus() {
  const { data } = useGetServiceStatusQuery();
  return data?.serviceStatus ?? null;
}
