// FIXTURE source file; gqlPrune only string-searches and text-scans it. It is
// never compiled, typechecked or linted, and the imports resolve to nothing.
//
// Two rules hold for every comment in this file: never write an operation name
// outside a document body, and never write a usage-pattern identifier such as
// useSomethingQuery outside one either. The suite asserts that the dead
// documents below grade "high" precisely because their names appear nowhere in
// the scanned corpus, and a stray mention in a comment would quietly turn that
// into "low".
//
// The suite also asserts the reported line of each document. It locates the
// expected line by searching this file for the `query <Name> {` line, so keep
// each operation keyword and its name on one line.
import { gql } from 'graphql-tag';
import { graphql } from './gql';

// A tag inside a line comment is not code, so this defines nothing:
// export const commented = gql`query GetCommentedOut { note { id } }`;

/*
 * A tag inside a block comment defines nothing either:
 * export const blocked = gql`query GetBlockCommented { note { id } }`;
 */

// Nor does one inside an ordinary string literal.
export const snippet = "gql`query GetQuotedAway { note { id } }`";

// Dead, and named nowhere else in this project. It sits well past the top of
// the file, which is the point: the reported line has to be its real line here.
gql`
  query GetInlineAbandoned {
    note {
      id
      body
    }
  }
`;

// SELF-USAGE INVARIANT. The body below contains, in a GraphQL comment, the
// exact identifier the built-in use{Name}{Type} pattern searches for. That text
// is the document itself, never a reference to it, so this operation must still
// be reported unused. If it ever comes back used, a document is counting as its
// own usage and every dead inline query is being declared alive.
gql`
  # useGetSelfReferencedQuery
  query GetSelfReferenced {
    note {
      id
    }
  }
`;

// DEFINITION-CONSTANT INVARIANT. The constant this document is assigned to
// matches the built-in {Name}Document pattern character for character, and
// nothing anywhere references it. The declaration is the definition site, not a
// reference, so this operation must still be reported unused. A regression here
// marks every codegen-style dead query alive, which is the worst result this
// tool can produce.
export const GetInlineDocumentedDocument = graphql(`
  query GetInlineDocumented {
    note {
      id
    }
  }
`);
