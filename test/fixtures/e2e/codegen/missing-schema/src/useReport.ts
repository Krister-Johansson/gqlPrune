// FIXTURE source file; string-searched only, never compiled.
import { useGetKeptReportQuery } from './generated/graphql';

export function useReport() {
  const { data } = useGetKeptReportQuery();
  return data?.report ?? null;
}
