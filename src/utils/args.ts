import { CliConfig } from '../types/GqlPruneConfig.js';

export type CliOptions = {
  command?: string;
  json: boolean;
  annotate: boolean;
  config: CliConfig;
};

/**
 * Parses CLI arguments (everything after the node binary and script path).
 *
 * Recognizes the optional `init` command, the boolean `--json` / `--annotate`
 * flags, and value flags that mirror the config file: `--graphql`, `--src`,
 * and the repeatable `--ignore`, `--pattern`, `--fragment-pattern`. Value flags
 * accept both `--flag value` and `--flag=value`, in any order. A value is never
 * mistaken for the positional command.
 *
 * @param {string[]} argv - Arguments, e.g. `process.argv.slice(2)`.
 * @returns {CliOptions} - The resolved command, flags, and CLI config overrides.
 */
export function parseArgs(argv: string[]): CliOptions {
  const config: CliConfig = {};
  const excludedFolders: string[] = [];
  const usagePatterns: string[] = [];
  const fragmentUsagePatterns: string[] = [];
  let command: string | undefined;
  let json = false;
  let annotate = false;

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
    // itself a flag (so a value is never consumed as the command).
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        i += 1;
        return next;
      }
      return undefined;
    };

    switch (name) {
      case '--json':
        json = true;
        break;
      case '--annotate':
        annotate = true;
        break;
      case '--graphql': {
        const value = takeValue();
        if (value !== undefined) config.graphqlDir = value;
        break;
      }
      case '--src': {
        const value = takeValue();
        if (value !== undefined) config.srcDir = value;
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
        if (!arg.startsWith('-') && command === undefined) command = arg;
    }
  }

  if (excludedFolders.length > 0) config.excludedFolders = excludedFolders;
  if (usagePatterns.length > 0) config.usagePatterns = usagePatterns;
  if (fragmentUsagePatterns.length > 0) {
    config.fragmentUsagePatterns = fragmentUsagePatterns;
  }

  return { command, json, annotate, config };
}
