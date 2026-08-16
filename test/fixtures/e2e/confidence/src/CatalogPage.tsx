// FIXTURE source file; string-searched only, never compiled. Ordinary source,
// not generated: nothing about its name, folder or header says otherwise.
//
// It names one dead operation in a telemetry string and in no other form. That
// single mention in ordinary source is what grades that operation "low".
import { useGetCatalogListQuery } from './generated/graphql';

export function CatalogPage() {
  const { data } = useGetCatalogListQuery();
  return data;
}

export function trackLegacyView() {
  return { event: 'GetConfidenceLow' };
}
