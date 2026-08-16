// FIXTURE source file; string-searched and text-scanned only, never compiled.
// Keep operation names out of these comments: the suite asserts that the dead
// inline document grades "high" because its name appears nowhere else.
import { useQuery } from '@apollo/client';
import { graphql } from './__generated__';

const dashboardDocument = graphql(`
  query GetCombinedDashboard {
    dashboard {
      id
      headline
      refreshedAt
    }
  }
`);

// Dead: assigned to nothing, referenced by nothing.
graphql(`
  query GetCombinedInlineGhost {
    ghost {
      id
    }
  }
`);

export function Dashboard() {
  const { data } = useQuery(dashboardDocument);
  const dashboard = data?.dashboard;
  // Reading every key the document above selects, so --fields has nothing to
  // say about this file: the document's own text is blanked out of the corpus,
  // and these reads are what keep the keys alive.
  return dashboard ? `${dashboard.headline} ${dashboard.refreshedAt}` : null;
}
