// FIXTURE source file; parsed by gqlPrune, never compiled.
import { useGetKeptReportQuery } from './generated/graphql';

export function useReport() {
  const { data } = useGetKeptReportQuery();
  return data?.report ?? null;
}
