// FIXTURE source file; string-searched and text-scanned only, never compiled.
//
// The client-preset path: the document is assigned to a constant and the
// constant is what the component uses. No usage pattern can match that, so the
// operation stays alive only because gqlPrune follows the identifier.
import { useQuery } from '@apollo/client';
import { graphql } from './gql';

const dashboardDocument = graphql(`
  query GetInlineDashboard {
    dashboard {
      id
      headline
    }
  }
`);

export function Dashboard() {
  const { data } = useQuery(dashboardDocument);
  return data?.dashboard?.headline ?? null;
}
