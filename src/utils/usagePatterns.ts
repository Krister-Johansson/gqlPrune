import { OperationInfo } from '../types/OperationInfo.js';
import { capitalizeFirstLetter } from './stringHelpers.js';

/**
 * Default patterns used to detect whether a GraphQL operation is referenced in
 * source code. Each entry is a template that is expanded per operation using
 * the placeholders documented below.
 *
 * The defaults target GraphQL Code Generator output (the
 * `typescript-react-apollo` / near-operation-file presets) and cover:
 *   - the standard hook            e.g. `useGetUserQuery`
 *   - the lazy hook variant        e.g. `useGetUserLazyQuery`
 *   - the suspense hook variant    e.g. `useGetUserSuspenseQuery`
 *   - the generated document const e.g. `GetUserDocument`
 *
 * Projects using a different convention (urql, react-query, graphql-request,
 * Vue, raw documents, ...) can override these via `usagePatterns` in
 * `gqlPrune.config.yaml`.
 *
 * Placeholders:
 *   {name} / {Name} - operation name verbatim / capitalized
 *   {type} / {Type} - operation type (query|mutation|subscription) verbatim / capitalized
 */
export const DEFAULT_USAGE_PATTERNS = [
  'use{Name}{Type}',
  'use{Name}Lazy{Type}',
  'use{Name}Suspense{Type}',
  '{Name}Document',
];

/**
 * Expands a single pattern template for a given operation by substituting the
 * `{name}`, `{Name}`, `{type}` and `{Type}` placeholders.
 */
export function expandPattern(pattern: string, op: OperationInfo): string {
  return pattern
    .replace(/\{Name\}/g, capitalizeFirstLetter(op.name))
    .replace(/\{name\}/g, op.name)
    .replace(/\{Type\}/g, capitalizeFirstLetter(op.type))
    .replace(/\{type\}/g, op.type);
}

/**
 * Builds the de-duplicated list of concrete search strings used to determine
 * whether an operation is used, based on the configured (or default) patterns.
 */
export function buildUsagePatterns(
  op: OperationInfo,
  patterns: string[] = DEFAULT_USAGE_PATTERNS,
): string[] {
  return [...new Set(patterns.map((pattern) => expandPattern(pattern, op)))];
}

/**
 * Default patterns used to detect whether a fragment is referenced directly in
 * source code — e.g. GraphQL Code Generator's `<Name>FragmentDoc` constant under
 * fragment masking. Only `{name}` / `{Name}` placeholders apply (fragments have
 * no operation type). Override via `fragmentUsagePatterns` in the config.
 */
export const DEFAULT_FRAGMENT_USAGE_PATTERNS = ['{Name}FragmentDoc'];

/**
 * Builds the de-duplicated list of concrete search strings used to determine
 * whether a fragment is referenced in source code.
 */
export function buildFragmentPatterns(
  fragmentName: string,
  patterns: string[] = DEFAULT_FRAGMENT_USAGE_PATTERNS,
): string[] {
  const capitalized = capitalizeFirstLetter(fragmentName);
  return [
    ...new Set(
      patterns.map((pattern) =>
        pattern
          .replace(/\{Name\}/g, capitalized)
          .replace(/\{name\}/g, fragmentName),
      ),
    ),
  ];
}
