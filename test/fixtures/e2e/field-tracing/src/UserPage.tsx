// FIXTURE source file for the field-tracing e2e spec; parsed by gqlPrune,
// never compiled. The import targets do not exist.
import { useGetTracedUserQuery } from './generated';
import { ProfileCard } from './ProfileCard';

export function UserPage() {
  const { data, loading } = useGetTracedUserQuery({ variables: { id: '1' } });
  if (loading || !data?.user) return null;
  const { name: displayName, address } = data.user;
  return (
    <main key={data.user.id}>
      <h1>{displayName}</h1>
      <p>{address?.city}</p>
      <ProfileCard user={data.user} />
    </main>
  );
}
