// Fixture source file. gqlPrune only string-searches it; it is never compiled,
// typechecked, or linted, and the import target does not exist.
//
// Every response key the used documents select is named somewhere in this
// directory except one, which is what the --fields case relies on. Do not add
// that key here, not even in a comment: the check is a plain string search.
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
