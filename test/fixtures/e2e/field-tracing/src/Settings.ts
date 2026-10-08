// FIXTURE source file for the field-tracing e2e spec; parsed by gqlPrune,
// never compiled. The import targets do not exist.
import { useGetEscapedSettingsQuery } from './generated';
import { persist } from './persist';

export function useSettings() {
  const { data } = useGetEscapedSettingsQuery();
  persist(data?.settings);
}
