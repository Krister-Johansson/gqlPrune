import { CliConfig } from '../types/GqlPruneConfig.js';

export type CliOptions = {
  command?: string;
  json: boolean;
  annotate: boolean;
  version: boolean;
  verbose: boolean;
  help: boolean;
  /** Usage problems (unknown flag, missing value, stray argument), in order. */
  errors: string[];
  config: CliConfig;
};

/** The usage screen printed by `--help` / `-h`. */
export function formatHelp(): string {
  return `gqlPrune — find unused GraphQL operations and fragments

Usage:
  gqlprune [command] [flags]

Commands:
  init                      Create gqlPrune.config.yaml interactively

Flags:
  --graphql <dir>           Directory with .gql/.graphql files (repeatable)
  --src <dir>               Directory with source files (repeatable)
  --exclude <glob>          Files/folders to skip; gitignore-style globs (repeatable)
  --ignore <folder>         Deprecated: use --exclude instead
  --pattern <template>      Operation usage pattern, e.g. use{Name}{Type} (repeatable)
  --fragment-pattern <t>    Fragment usage pattern, e.g. {Name}FragmentDoc (repeatable)
  --json                    Print a machine-readable JSON report on stdout
  --annotate                Emit GitHub Actions ::warning annotations (auto in Actions)
  --verbose                 Explain each verdict on stderr
  -v, --version             Print the installed version
  -h, --help                Show this help

Flags accept both "--flag value" and "--flag=value" and override the matching
field in gqlPrune.config.yaml.
Docs: https://github.com/Krister-Johansson/gqlPrune#readme`;
}

/**
 * Parses CLI arguments (everything after the node binary and script path).
 *
 * Recognizes the optional `init` command, the boolean `--json` / `--annotate`
 * / `--verbose` / `--help` flags, and value flags that mirror the config file:
 * the repeatable `--graphql`, `--src`, `--exclude`, `--ignore`, `--pattern`,
 * `--fragment-pattern`. Value flags accept both `--flag value` and
 * `--flag=value`, in any order. A value is never mistaken for the positional
 * command. Unknown flags, flags missing their value, and stray positional
 * arguments are collected into `errors` rather than silently dropped — the
 * caller decides how to report them.
 *
 * @param {string[]} argv - Arguments, e.g. `process.argv.slice(2)`.
 * @returns {CliOptions} - The resolved command, flags, and CLI config overrides.
 */
export function parseArgs(argv: string[]): CliOptions {
  const config: CliConfig = {};
  const graphqlDirs: string[] = [];
  const srcDirs: string[] = [];
  const exclude: string[] = [];
  const excludedFolders: string[] = [];
  const usagePatterns: string[] = [];
  const fragmentUsagePatterns: string[] = [];
  const errors: string[] = [];
  let command: string | undefined;
  let json = false;
  let annotate = false;
  let version = false;
  let verbose = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Support `--flag=value` alongside `--flag value`.
    let name = arg;
    let inlineValue: string | undefined;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        name = arg.slice(0, eq);
        inlineValue = arg.slice(eq + 1);
      }
    }

    // The flag's value: the inline `=value`, else the next arg when it isn't
    // itself a flag (so a value is never consumed as the command). A flag
    // without a value is a usage error, not a silent no-op.
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined && inlineValue !== '') return inlineValue;
      if (inlineValue === undefined) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          i += 1;
          return next;
        }
      }
      errors.push(`Missing value for ${name}`);
      return undefined;
    };

    switch (name) {
      case '--json':
        json = true;
        break;
      case '--annotate':
        annotate = true;
        break;
      case '--verbose':
        verbose = true;
        break;
      case '--version':
      case '-v':
        version = true;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      case '--graphql': {
        const value = takeValue();
        if (value !== undefined) graphqlDirs.push(value);
        break;
      }
      case '--src': {
        const value = takeValue();
        if (value !== undefined) srcDirs.push(value);
        break;
      }
      case '--exclude': {
        const value = takeValue();
        if (value !== undefined) exclude.push(value);
        break;
      }
      case '--ignore': {
        const value = takeValue();
        if (value !== undefined) excludedFolders.push(value);
        break;
      }
      case '--pattern': {
        const value = takeValue();
        if (value !== undefined) usagePatterns.push(value);
        break;
      }
      case '--fragment-pattern': {
        const value = takeValue();
        if (value !== undefined) fragmentUsagePatterns.push(value);
        break;
      }
      default:
        if (arg.startsWith('-')) {
          errors.push(`Unknown flag: ${name}`);
        } else if (command === undefined) {
          command = arg;
        } else {
          errors.push(`Unexpected argument: ${arg}`);
        }
    }
  }

  // A single value keeps the plain-string shape; repeats become an array,
  // matching the config schema (`string | string[]`).
  if (graphqlDirs.length > 0) {
    config.graphqlDir = graphqlDirs.length === 1 ? graphqlDirs[0] : graphqlDirs;
  }
  if (srcDirs.length > 0) {
    config.srcDir = srcDirs.length === 1 ? srcDirs[0] : srcDirs;
  }
  if (exclude.length > 0) config.exclude = exclude;
  if (excludedFolders.length > 0) config.excludedFolders = excludedFolders;
  if (usagePatterns.length > 0) config.usagePatterns = usagePatterns;
  if (fragmentUsagePatterns.length > 0) {
    config.fragmentUsagePatterns = fragmentUsagePatterns;
  }

  return { command, json, annotate, version, verbose, help, errors, config };
}
