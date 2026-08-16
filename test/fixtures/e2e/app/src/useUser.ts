// Fixture source file. gqlPrune only string-searches it; it is never compiled,
// typechecked, or linted, and the import target does not exist.
import { useGetUserQuery } from './hooks';

export function useUser(id: string) {
  const { data } = useGetUserQuery({ variables: { id } });
  const user = data?.user;
  return {
    id: user?.id,
    name: user?.name,
    legacyDisplayName: user?.legacyDisplayName,
  };
}
