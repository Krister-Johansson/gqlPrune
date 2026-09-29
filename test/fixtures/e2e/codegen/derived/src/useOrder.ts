// FIXTURE source file; parsed by gqlPrune, never compiled.
import { useGetOrderQuery } from './generated/graphql';

export function useOrder(id: string) {
  const { data } = useGetOrderQuery({ variables: { id } });
  return data?.order ?? null;
}
