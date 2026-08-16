// Fixture source file; string-searched only, never compiled.
import { useGetInvoiceQuery } from './hooks';

export function Invoice() {
  const { data } = useGetInvoiceQuery();
  return data;
}
