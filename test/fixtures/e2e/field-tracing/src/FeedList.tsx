// FIXTURE source file for the field-tracing e2e spec; parsed by gqlPrune,
// never compiled. The import targets do not exist.
import { useQuery } from '@apollo/client';
import { GetTracedFeedDocument } from './generated';

export function FeedList() {
  const { data } = useQuery(GetTracedFeedDocument);
  const items = data?.feed ?? [];
  return (
    <ul>
      {items
        .filter((item) => item.title)
        .map((item) => (
          <li key={item.id}>{item.author?.name}</li>
        ))}
    </ul>
  );
}
