// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import {
  COMMANDS,
  CommandSpec,
  FLAGS,
  FlagSpec,
  SHELLS,
  Shell,
} from './args.js';

/** Narrows a raw CLI argument to a shell we can emit a script for. */
export function isShell(value: string | undefined): value is Shell {
  return value !== undefined && (SHELLS as readonly string[]).includes(value);
}

const COMMAND_NAMES = COMMANDS.map((spec) => spec.name);

/** Long forms plus short aliases, the way bash and zsh word lists want them. */
const ALL_FLAG_NAMES = FLAGS.flatMap((spec) =>
  spec.alias === undefined ? [spec.flag] : [spec.flag, spec.alias],
);

const PATH_FLAGS = FLAGS.filter((spec) => spec.valueKind === 'path');
const OPAQUE_VALUE_FLAGS = FLAGS.filter(
  (spec) => spec.takesValue && spec.valueKind !== 'path',
);
const ARGUMENT_COMMANDS = COMMANDS.filter(
  (spec) => spec.argValues !== undefined && spec.argValues.length > 0,
);

function argValuesOf(spec: CommandSpec): string {
  return (spec.argValues ?? []).join(' ');
}

/**
 * A `case` branch matching one or more flags. Returns an empty string when the
 * flag list is empty, so a table without such flags cannot emit `)` alone.
 */
function bashCase(flags: string[], body: string): string {
  if (flags.length === 0) return '';
  return `    ${flags.join('|')})\n${body}\n      return 0\n      ;;\n`;
}

function bashScript(): string {
  const pathCase = bashCase(
    PATH_FLAGS.map((spec) => spec.flag),
    '      COMPREPLY=($(compgen -A file -- "$cur"))',
  );
  const opaqueCase = bashCase(
    OPAQUE_VALUE_FLAGS.map((spec) => spec.flag),
    '      COMPREPLY=()',
  );
  const commandArgCases = ARGUMENT_COMMANDS.map((spec) =>
    bashCase(
      [spec.name],
      `      COMPREPLY=($(compgen -W "${argValuesOf(spec)}" -- "$cur"))`,
    ),
  ).join('');

  return `# bash completion for gqlprune
# Add this line to ~/.bashrc:
#   eval "$(gqlprune completion bash)"

_gqlprune_complete() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  case "$prev" in
${pathCase}${opaqueCase}${commandArgCases}  esac

  if [[ "$cur" == -* ]]; then
    COMPREPLY=($(compgen -W "${ALL_FLAG_NAMES.join(' ')}" -- "$cur"))
    return 0
  fi

  if [[ "$COMP_CWORD" -eq 1 ]]; then
    COMPREPLY=($(compgen -W "${COMMAND_NAMES.join(' ')}" -- "$cur"))
    return 0
  fi

  COMPREPLY=()
  return 0
}

complete -F _gqlprune_complete gqlprune
`;
}

/**
 * Escapes text for use inside a single-quoted zsh `_arguments` spec, where
 * `[`, `]` and `:` are structural and a quote would end the string.
 */
function zshEscape(text: string): string {
  return text
    .replace(/[\\[\]:]/g, (char) => `\\${char}`)
    .replace(/'/g, `'\\''`);
}

/** One `_arguments` spec, e.g. `'*--src[Directory ...]:directory:_files'`. */
function zshFlagSpec(spec: FlagSpec): string {
  const names =
    spec.alias === undefined ? [spec.flag] : [spec.alias, spec.flag];
  // Repeatable flags stay on offer; the rest exclude themselves once given.
  const prefix = spec.repeatable === true ? '*' : `(${names.join(' ')})`;
  const action = spec.takesValue
    ? `:${spec.valueKind === 'path' ? 'directory:_files' : 'value:'}`
    : '';
  const body = `[${zshEscape(spec.description)}]${action}`;

  return spec.alias === undefined
    ? `'${prefix}${spec.flag}${body}'`
    : `'${prefix}'{${spec.alias},${spec.flag}}'${body}'`;
}

function zshScript(): string {
  const flagSpecs = FLAGS.map((spec) => `    ${zshFlagSpec(spec)} \\\n`).join(
    '',
  );
  const commands = COMMANDS.map(
    (spec) => `    '${spec.name}:${zshEscape(spec.description)}'\n`,
  ).join('');
  const commandArgCases = ARGUMENT_COMMANDS.map(
    (spec) =>
      `        ${spec.name})\n          _values 'shell' ${argValuesOf(spec)}\n          ;;\n`,
  ).join('');

  return `#compdef gqlprune
# zsh completion for gqlprune
# Add this line to ~/.zshrc:
#   eval "$(gqlprune completion zsh)"

_gqlprune() {
  local curcontext="$curcontext" state line
  typeset -A opt_args
  local -a commands
  commands=(
${commands}  )

  _arguments -C \\
${flagSpecs}    '1: :->command' \\
    '*:: :->argument'

  case "$state" in
    command)
      _describe -t commands 'gqlprune command' commands
      ;;
    argument)
      case "\${line[1]}" in
${commandArgCases}      esac
      ;;
  esac
}

if (( $+functions[compdef] )); then
  compdef _gqlprune gqlprune
fi
`;
}

/** Escapes text for a single-quoted fish string. */
function fishEscape(text: string): string {
  return text.replace(/(['\\])/g, '\\$1');
}

function fishFlagLine(spec: FlagSpec): string {
  const parts = ['complete -c gqlprune'];
  if (spec.alias !== undefined)
    parts.push(`-s ${spec.alias.replace(/^-/, '')}`);
  parts.push(`-l ${spec.flag.replace(/^--/, '')}`);
  if (spec.takesValue) parts.push('-r');
  // -F re-enables the file completion that the leading `complete -c ... -f`
  // switched off for this command.
  if (spec.valueKind === 'path') parts.push('-F');
  parts.push(`-d '${fishEscape(spec.description)}'`);
  return parts.join(' ');
}

function fishScript(): string {
  const commands = COMMANDS.map(
    (spec) =>
      `complete -c gqlprune -n '__fish_use_subcommand' -a '${spec.name}' -d '${fishEscape(spec.description)}'`,
  ).join('\n');
  const commandArgs = ARGUMENT_COMMANDS.map(
    (spec) =>
      `complete -c gqlprune -n '__fish_seen_subcommand_from ${spec.name}' -a '${argValuesOf(spec)}'`,
  ).join('\n');
  const flags = FLAGS.map(fishFlagLine).join('\n');

  return `# fish completion for gqlprune
# Add this line to ~/.config/fish/config.fish:
#   gqlprune completion fish | source

# Values are file paths only where a flag asks for one.
complete -c gqlprune -f

${commands}
${commandArgs}

${flags}
`;
}

const GENERATORS: Record<Shell, () => string> = {
  bash: bashScript,
  zsh: zshScript,
  fish: fishScript,
};

/**
 * Builds the tab-completion script for a shell, straight from the {@link FLAGS}
 * and {@link COMMANDS} tables. The script only defines and registers a
 * completion for `gqlprune`; it never touches the user's shell rc files, which
 * is why the documented install is an `eval` line the user adds themselves.
 *
 * @param {Shell} shell - The target shell.
 * @returns {string} - The script text, ready for stdout.
 */
export function completionScript(shell: Shell): string {
  return GENERATORS[shell]();
}

/** The one-line usage hint for a bad or missing `completion` argument. */
export function completionUsage(): string {
  return `Usage: gqlprune completion <${SHELLS.join('|')}>`;
}
