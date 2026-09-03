// FIXTURE source file; string-searched only, never compiled.
import { useGetCombinedUserQuery } from './__generated__';

export function useUser(id: string) {
  const { data } = useGetCombinedUserQuery({ variables: { id } });
  const user = data?.user;
  return { id: user?.id, name: user?.name, legacyEmail: user?.legacyEmail };
}

export const RETIRED_EXPORTS = ['GetCombinedLegacyExport'];
