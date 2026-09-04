// FIXTURE source file; string-searched and text-scanned only, never compiled.
// Each document below is a shape that used to be graded wrongly. Keep the
// operation names out of the comments: the suite checks which ones are
// reported, and a name in a comment is a usage signal of its own.
import { gql, graphql, useQuery } from './stub';

// Consumed where it is written: the statement that defines it is the statement
// that uses it, so it can never be dead.
export const Widget = () => {
  const { data } = useQuery(gql`
    query ShapesConsumed {
      consumed {
        id
      }
    }
  `);
  return data;
};

// The form a printer produces once the annotation passes the print width.
// Losing the identifier here loses the only signal the client preset has.
export const ShapesAnnotatedDoc: TypedDocumentNode<
  ShapesAnnotatedQuery,
  ShapesAnnotatedQueryVariables
> = graphql(`
  query ShapesAnnotated {
    annotated {
      id
    }
  }
`);

// Standing alone as its own statement: nothing consumes it, nothing names it.
graphql(`
  query ShapesOrphan {
    orphan {
      id
    }
  }
`);
