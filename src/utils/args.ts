// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { CliConfig } from '../types/GqlPruneConfig.js';

/** Shells `gqlprune completion` can emit a script for. */
export const SHELLS = ['bash', 'zsh', 'fish'] as const;

export type Shell = (typeof SHELLS)[number];

/** Boolean flags, named after the `CliOptions` field they set. */
export type BooleanOption =
  'json' | 'annotate' | 'version' | 'verbose' | 'help';

/** The `CliConfig` field a value flag collects into. */
export type ValueTarget =
  | 'graphqlDir'
  | 'srcDir'
  | 'exclude'
  | 'excludedFolders'
  | 'usagePatterns'
  | 'fragmentUsagePatterns';

/**
 * One row of the CLI's flag table. `parseArgs`, `formatHelp` and the shell
 * completion generators all read this, so a flag can only be added in one
 * place — the parser, the help screen and the completions cannot drift apart.
 */
export type FlagSpec = {
  /** The long form, including the leading `--`. */
  flag: string;
  /** The short form, including the leading `-`, when one exists. */
  alias?: string;
  takesValue: boolean;
  /** Shown after the flag on the help screen, e.g. `<dir>`. */
  valuePlaceholder?: string;
  /** `path` hands value completion to the shell's own file picker. */
  valueKind?: 'path';
  /** Whether repeating the flag accumulates values. */
  repeatable?: boolean;
  description: string;
  /** Boolean flags: the `CliOptions` field this sets to true. */
  option?: BooleanOption;
  /** Value flags: the `CliConfig` field collected values land in. */
  target?: ValueTarget;
  /** Keep a lone value a plain string instead of a one-element array. */
  collapseSingle?: boolean;
};

/** One row of the CLI's command table; see {@link FlagSpec}. */
export type CommandSpec = {
  name: string;
  description: string;
  /** Shown after the command on the help screen, e.g. `<shell>`. */
  argPlaceholder?: string;
  /** The full set of values the command's single argument accepts. */
  argValues?: readonly string[];
};

/** Every flag the CLI understands, in help-screen order. */
export const FLAGS: readonly FlagSpec[] = [
  {
    flag: '--graphql',
    takesValue: true,
    valuePlaceholder: '<dir>',
    valueKind: 'path',
    repeatable: true,
    target: 'graphqlDir',
    collapseSingle: true,
    description: 'Directory with .gql/.graphql files (repeatable)',
  },
  {
    flag: '--src',
    takesValue: true,
    valuePlaceholder: '<dir>',
    valueKind: 'path',
    repeatable: true,
    target: 'srcDir',
    collapseSingle: true,
    description: 'Directory with source files (repeatable)',
  },
  {
    flag: '--exclude',
    takesValue: true,
    valuePlaceholder: '<glob>',
    repeatable: true,
    target: 'exclude',
    description: 'Files/folders to skip; gitignore-style globs (repeatable)',
  },
  {
    flag: '--ignore',
    takesValue: true,
    valuePlaceholder: '<folder>',
    repeatable: true,
    target: 'excludedFolders',
    description: 'Deprecated: use --exclude instead',
  },
  {
    flag: '--pattern',
    takesValue: true,
    valuePlaceholder: '<template>',
    repeatable: true,
    target: 'usagePatterns',
    description: 'Operation usage pattern, e.g. use{Name}{Type} (repeatable)',
  },
  {
    flag: '--fragment-pattern',
    takesValue: true,
    valuePlaceholder: '<t>',
    repeatable: true,
    target: 'fragmentUsagePatterns',
    description: 'Fragment usage pattern, e.g. {Name}FragmentDoc (repeatable)',
  },
  {
    flag: '--json',
    takesValue: false,
    option: 'json',
    description: 'Print a machine-readable JSON report on stdout',
  },
  {
    flag: '--annotate',
    takesValue: false,
    option: 'annotate',
    description: 'Emit GitHub Actions ::warning annotations (auto in Actions)',
  },
  {
    flag: '--verbose',
    takesValue: false,
    option: 'verbose',
    description: 'Explain each verdict on stderr',
  },
  {
    flag: '--version',
    alias: '-v',
    takesValue: false,
    option: 'version',
    description: 'Print the installed version',
  },
  {
    flag: '--help',
    alias: '-h',
    takesValue: false,
    option: 'help',
    description: 'Show this help',
  },
];

/** Every command the CLI understands, in help-screen order. */
export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'init',
    description: 'Create gqlPrune.config.yaml interactively',
  },
  {
    name: 'completion',
    argPlaceholder: '<shell>',
    argValues: SHELLS,
    description: 'Print a tab-completion script for bash, zsh, or fish',
  },
];

const FLAG_BY_NAME = new Map<string, FlagSpec>(
  FLAGS.flatMap((spec) =>
    spec.alias === undefined
      ? [[spec.flag, spec] as const]
      : [[spec.flag, spec] as const, [spec.alias, spec] as const],
  ),
);

const COMMAND_BY_NAME = new Map<string, CommandSpec>(
  COMMANDS.map((spec) => [spec.name, spec] as const),
);

export type CliOptions = {
  command?: string;
  /** The single positional a command may take, e.g. the shell name. */
  commandArg?: string;
  json: boolean;
  annotate: boolean;
  version: boolean;
  verbose: boolean;
  help: boolean;
  /** Usage problems (unknown flag, missing value, stray argument), in order. */
  errors: string[];
  config: CliConfig;
};

/** The help-screen label for a flag, e.g. `-v, --version` or `--src <dir>`. */
export function flagLabel(spec: FlagSpec): string {
  const names =
    spec.alias === undefined ? spec.flag : `${spec.alias}, ${spec.flag}`;
  return spec.valuePlaceholder === undefined
    ? names
    : `${names} ${spec.valuePlaceholder}`;
}

/** The help-screen label for a command, e.g. `completion <shell>`. */
export function commandLabel(spec: CommandSpec): string {
  return spec.argPlaceholder === undefined
    ? spec.name
    : `${spec.name} ${spec.argPlaceholder}`;
}

/** Column the descriptions line up in, measured from the label's indent. */
const LABEL_WIDTH = 26;

function helpRow(label: string, description: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${description}`;
}

/** The usage screen printed by `--help` / `-h`, rendered from the tables. */
export function formatHelp(): string {
  const commands = COMMANDS.map((spec) =>
    helpRow(commandLabel(spec), spec.description),
  ).join('\n');
  const flags = FLAGS.map((spec) =>
    helpRow(flagLabel(spec), spec.description),
  ).join('\n');

  return `gqlPrune — find unused GraphQL operations and fragments

Usage:
  gqlprune [command] [flags]

Commands:
${commands}

Flags:
${flags}

Flags accept both "--flag value" and "--flag=value" and override the matching
field in gqlPrune.config.yaml.
Docs: https://github.com/Krister-Johansson/gqlPrune#readme`;
}

/**
 * Writes a collected value onto the config. The cast narrows the union of
 * property types down to what the table already guarantees: only targets
 * marked `collapseSingle` are handed a bare string, and those fields accept
 * `string | string[]`.
 */
function setConfigValue(
  config: CliConfig,
  target: ValueTarget,
  value: string | string[],
): void {
  (config as Record<ValueTarget, string | string[]>)[target] = value;
}

/**
 * Parses CLI arguments (everything after the node binary and script path).
 *
 * Commands and flags come from the {@link COMMANDS} and {@link FLAGS} tables.
 * Value flags accept both `--flag value` and `--flag=value`, in any order, and
 * a value is never mistaken for the positional command. A command listed with
 * `argValues` (today only `completion`) takes one further positional, kept as
 * `commandArg`. Unknown flags, flags missing their value, and stray positional
 * arguments are collected into `errors` rather than silently dropped — the
 * caller decides how to report them.
 *
 * @param {string[]} argv - Arguments, e.g. `process.argv.slice(2)`.
 * @returns {CliOptions} - The resolved command, flags, and CLI config overrides.
 */
export function parseArgs(argv: string[]): CliOptions {
  const collected = new Map<ValueTarget, string[]>();
  const options: Record<BooleanOption, boolean> = {
    json: false,
    annotate: false,
    version: false,
    verbose: false,
    help: false,
  };
  const errors: string[] = [];
  let command: string | undefined;
  let commandArg: string | undefined;

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

    const spec = FLAG_BY_NAME.get(name);
    if (spec === undefined) {
      if (arg.startsWith('-')) {
        errors.push(`Unknown flag: ${name}`);
      } else if (command === undefined) {
        command = arg;
      } else if (
        commandArg === undefined &&
        COMMAND_BY_NAME.get(command)?.argValues !== undefined
      ) {
        commandArg = arg;
      } else {
        errors.push(`Unexpected argument: ${arg}`);
      }
      continue;
    }

    if (!spec.takesValue) {
      if (spec.option !== undefined) options[spec.option] = true;
      continue;
    }

    // The flag's value: the inline `=value`, else the next arg when it isn't
    // itself a flag (so a value is never consumed as the command). A flag
    // without a value is a usage error, not a silent no-op.
    let value: string | undefined;
    if (inlineValue !== undefined && inlineValue !== '') {
      value = inlineValue;
    } else if (inlineValue === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        value = next;
        i += 1;
      }
    }

    if (value === undefined) {
      errors.push(`Missing value for ${name}`);
      continue;
    }
    if (spec.target !== undefined) {
      const values = collected.get(spec.target) ?? [];
      values.push(value);
      collected.set(spec.target, values);
    }
  }

  // A single value keeps the plain-string shape where the config allows it;
  // repeats become an array, matching the schema (`string | string[]`).
  const config: CliConfig = {};
  for (const spec of FLAGS) {
    if (spec.target === undefined) continue;
    const values = collected.get(spec.target);
    if (values === undefined || values.length === 0) continue;
    setConfigValue(
      config,
      spec.target,
      spec.collapseSingle === true && values.length === 1 ? values[0] : values,
    );
  }

  return { command, commandArg, ...options, errors, config };
}
