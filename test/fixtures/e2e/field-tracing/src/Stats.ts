// FIXTURE source file for the field-tracing e2e spec; parsed by gqlPrune,
// never compiled. The import targets do not exist.
import { client } from './client';
import { GetFallbackStatsDocument } from './generated';

export async function loadVisits() {
  const result = await client.query({ query: GetFallbackStatsDocument });
  return result.data.stats.visits;
}
