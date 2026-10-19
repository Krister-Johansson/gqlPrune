// FIXTURE source file for the field-tracing e2e spec; parsed by gqlPrune,
// never compiled. The import target does not exist.
import { useSaveTracedUserMutation } from './generated';

export function SaveButton() {
  const [save] = useSaveTracedUserMutation();
  return <button onClick={() => save()}>Save</button>;
}
