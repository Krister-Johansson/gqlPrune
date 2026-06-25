export interface GqlPruneConfig {
  /** Directory (or directories) containing your `.gql`/`.graphql` files. */
  graphqlDir: string | string[];
  /** Directory (or directories) containing your source files. */
  srcDir: string | string[];
  /**
   * Folder names (e.g. `__generated__`) or paths relative to the project root
   * (e.g. `src/generated`) to exclude from traversal. `node_modules` and `.git`
   * are always excluded.
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
}

/**
 * Configuration that can be supplied as CLI flags instead of (or on top of)
 * `gqlPrune.config.yaml`. The list fields come from repeatable flags and
 * replace — rather than merge with — their YAML counterparts.
 */
export type CliConfig = Partial<
  Pick<
    GqlPruneConfig,
    'graphqlDir' | 'srcDir' | 'usagePatterns' | 'fragmentUsagePatterns'
  >
> & { excludedFolders?: string[] };
