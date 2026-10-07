// FIXTURE, NOT GENERATED OUTPUT. Nothing produces this file; it is committed by
// hand under test/fixtures/, and gqlPrune parses it but never compiles it. It
// imitates GraphQL Code Generator output well enough to trip gqlPrune's
// masking heuristic: the basename is graphql.ts, it sits in a folder called
// generated, and for eight of the project's eleven operations it declares the
// hook and references the document constant from inside it, the way real
// output does.
export const GetCatalogItemDocument = {};
export const useGetCatalogItemQuery = () => useQuery(GetCatalogItemDocument);
export const GetCatalogListDocument = {};
export const useGetCatalogListQuery = () => useQuery(GetCatalogListDocument);
export const GetCatalogFacetsDocument = {};
export const useGetCatalogFacetsQuery = () => useQuery(GetCatalogFacetsDocument);
export const GetCatalogBrandsDocument = {};
export const useGetCatalogBrandsQuery = () => useQuery(GetCatalogBrandsDocument);
export const GetCatalogStockDocument = {};
export const useGetCatalogStockQuery = () => useQuery(GetCatalogStockDocument);
export const GetCatalogPricesDocument = {};
export const useGetCatalogPricesQuery = () => useQuery(GetCatalogPricesDocument);
export const GetCatalogReviewsDocument = {};
export const useGetCatalogReviewsQuery = () => useQuery(GetCatalogReviewsDocument);
export const UpdateCatalogItemDocument = {};
export const useUpdateCatalogItemMutation = () => useQuery(UpdateCatalogItemDocument);

// A leftover entry naming one dead operation, and nothing but its bare name in
// a string: no hook, no document constant, so no usage pattern matches it. This
// mention is the whole reason that operation grades "medium" rather than
// "high", and it must stay confined to this file.
export const RETIRED_OPERATIONS = ['GetConfidenceMedium'];
