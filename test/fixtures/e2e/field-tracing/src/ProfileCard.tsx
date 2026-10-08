// FIXTURE source file for the field-tracing e2e spec; parsed by gqlPrune,
// never compiled. The one component hop the trace follows.
export function ProfileCard({ user }: { user: { bio?: string } }) {
  return <p className="bio">{user.bio}</p>;
}
