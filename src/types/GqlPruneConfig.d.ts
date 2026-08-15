// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

export interface GqlPruneConfig {
  /**
   * Directory (or directories) containing your `.gql`/`.graphql` files. An
   * entry may also be a glob pattern, expanded to the directories it matches
   * before the scan (see the README for examples).
   */
  graphqlDir: string | string[];
  /**
   * Directory (or directories) containing your source files. Accepts glob
   * patterns like `graphqlDir`.
   */
  srcDir: string | string[];
  /**
   * Glob patterns (gitignore-flavored) for files and folders to skip during
   * traversal. A name without a slash matches anywhere by basename; a path with
   * a slash is anchored to the project root; a leading `!` re-includes.
   * Examples: `__generated__`, `*.generated.ts`, `src/legacy`, `!keep`.
   * `node_modules` and `.git` are always excluded.
   */
  exclude?: string | string[];
  /**
   * @deprecated Use `exclude` instead. Folder names (e.g. `__generated__`) or
   * paths relative to the project root (e.g. `src/generated`) to exclude. Still
   * honored — merged into the same matcher as `exclude`.
   */
  excludedFolders?: string[] | string;
  /**
   * Templates used to detect whether an operation is referenced in source code.
   * Supports `{name}`, `{Name}`, `{type}` and `{Type}` placeholders. Defaults to
   * GraphQL Code Generator hook/document conventions when omitted.
   */
  usagePatterns?: string[];
  /**
   * Templates used to detect whether a fragment is referenced directly in source
   * code (e.g. a `<Name>FragmentDoc` constant under fragment masking). Supports
   * `{name}` / `{Name}` placeholders. Defaults to `{Name}FragmentDoc` when
   * omitted; pass an empty array `[]` to disable source-reference detection and
   * rely only on fragment-spread reachability.
   */
  fragmentUsagePatterns?: string[];
  /**
   * Path to a local SDL file (e.g. `./schema.graphql`). Opt-in: when set,
   * operations and fragments are also checked against the schema's
   * `@deprecated` fields and enum values. Omit it and the scan stays entirely
   * schema-free.
   */
  schemaFile?: string;
  /**
   * Opt in to the advisory field-candidate list: response keys selected by a
   * used operation (or a fragment it reaches) whose name appears nowhere in the
   * scanned source. Off by default, and never changes the exit code. Set to
   * `true`, or pass `--fields`.
   */
  checkFields?: boolean;
}

/**
 * Configuration that can be supplied as CLI flags instead of (or on top of)
 * `gqlPrune.config.yaml`. The list fields come from repeatable flags and
 * replace — rather than merge with — their YAML counterparts.
 */
export type CliConfig = Partial<
  Pick<
    GqlPruneConfig,
    | 'graphqlDir'
    | 'srcDir'
    | 'exclude'
    | 'usagePatterns'
    | 'fragmentUsagePatterns'
    | 'schemaFile'
    | 'checkFields'
  >
> & { excludedFolders?: string[] };
