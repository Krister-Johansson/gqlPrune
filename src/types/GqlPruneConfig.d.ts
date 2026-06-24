export interface GqlPruneConfig {
  graphqlDir: string;
  srcDir: string;
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
}
