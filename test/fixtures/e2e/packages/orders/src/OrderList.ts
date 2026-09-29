// Fixture source file; parsed by gqlPrune, never compiled.
import { useGetOrderListQuery } from './hooks';

export function OrderList() {
  const { data } = useGetOrderListQuery();
  return data;
}
