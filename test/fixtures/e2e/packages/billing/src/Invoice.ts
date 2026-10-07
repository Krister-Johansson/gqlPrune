// Fixture source file; parsed by gqlPrune, never compiled.
import { useGetInvoiceQuery } from './hooks';

export function Invoice() {
  const { data } = useGetInvoiceQuery();
  return data;
}
