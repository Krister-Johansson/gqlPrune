export type CliOptions = {
  command?: string;
  json: boolean;
  annotate: boolean;
};

/**
 * Parses CLI arguments (everything after the node binary and script path).
 * Recognizes the optional `init` command and the `--json` / `--annotate` flags,
 * in any order.
 *
 * @param {string[]} argv - Arguments, e.g. `process.argv.slice(2)`.
 * @returns {CliOptions} - The resolved command and flags.
 */
export function parseArgs(argv: string[]): CliOptions {
  return {
    command: argv.find((arg) => !arg.startsWith('-')),
    json: argv.includes('--json'),
    annotate: argv.includes('--annotate'),
  };
}
