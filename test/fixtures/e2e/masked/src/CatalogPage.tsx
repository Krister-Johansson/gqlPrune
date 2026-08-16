// Fixture source file; string-searched only, never compiled. It references one
// of the six operations, well under the coverage threshold, so the masking
// warning names only pretend-codegen/graphql.ts.
import { useGetCatalogListQuery } from './pretend-codegen/graphql';

export function CatalogPage() {
  const { data } = useGetCatalogListQuery();
  return data;
}
