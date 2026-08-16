// FIXTURE source file; string-searched and text-scanned only, never compiled.
import { gql } from 'graphql-tag';
import { graphql } from './gql';

// Defined inline, spread by graphql/report.gql.
gql`
  fragment InlineBadgeFields on Report {
    badge
  }
`;

// Defined inline, spreads a fragment that lives in graphql/fragments.gql.
export const metaDocument = graphql(`
  query GetReportMeta {
    report {
      ...GqlReportMetaFields
    }
  }
`);
