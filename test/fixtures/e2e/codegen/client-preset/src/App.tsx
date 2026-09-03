// FIXTURE source file; string-searched and text-scanned only, never compiled.
// Keep operation names out of the comments here: the suite asserts the dead
// document grades "high" because its name appears nowhere else.
import { useQuery } from '@apollo/client';
import { graphql } from './gql';

const listDocument = graphql(`
  query GetClientList {
    list {
      id
    }
  }
`);

// Dead: assigned to nothing and referenced by nothing.
graphql(`
  query GetClientOrphan {
    list {
      id
      archivedAt
    }
  }
`);

export function App() {
  const { data } = useQuery(listDocument);
  return data?.list ?? null;
}
