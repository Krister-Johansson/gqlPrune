// Fixture source file; string-searched only, never compiled.
import { useGetOrderListQuery } from './hooks';

export function OrderList() {
  const { data } = useGetOrderListQuery();
  return data;
}
