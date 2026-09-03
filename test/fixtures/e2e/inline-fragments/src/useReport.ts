// FIXTURE source file; string-searched and text-scanned only, never compiled.
import { useQuery } from '@apollo/client';
import { useGetReportQuery } from './hooks';
import { metaDocument } from './badges';

export function useReport() {
  const { data } = useGetReportQuery();
  const meta = useQuery(metaDocument);
  return { report: data?.report ?? null, meta: meta.data ?? null };
}
