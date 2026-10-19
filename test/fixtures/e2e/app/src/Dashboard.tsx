// Fixture source file. gqlPrune parses it; it is never compiled, typechecked,
// or linted, and the import target does not exist.
//
// Every response key the used documents select is read somewhere in this
// directory except one, which is what the --fields case relies on. Do not read
// that key here, and keep its name out of comments too: an operation the
// field check cannot trace falls back to a plain text search.
import { useGetDashboardQuery } from './hooks';

export function Dashboard() {
  const { data } = useGetDashboardQuery();
  const dashboard = data?.dashboard;
  if (!dashboard) return null;
  return (
    <section id={dashboard.id}>
      <h1>{dashboard.headline}</h1>
      <p>Refreshed at {dashboard.refreshedAt}</p>
    </section>
  );
}
