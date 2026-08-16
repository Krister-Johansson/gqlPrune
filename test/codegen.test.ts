// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import * as fs from 'fs';
import {
  CODEGEN_FILENAMES,
  CODEGEN_PATTERN_MAPPINGS,
  CodegenConfig,
  deriveGqlPruneConfig,
  discoverCodegenConfig,
  extractCodegenFromSource,
  formatCodegenInfoLine,
  formatCodegenVerboseLines,
  globToDirectory,
  loadCodegenConfig,
} from '../src/utils/codegen';
import {
  DEFAULT_FRAGMENT_USAGE_PATTERNS,
  DEFAULT_USAGE_PATTERNS,
} from '../src/utils/usagePatterns';

jest.mock('fs');

const mockedExists = fs.existsSync as unknown as jest.Mock;
const mockedRead = fs.readFileSync as unknown as jest.Mock;

/** Presents `files` as the only readable files in the working directory. */
function mockFiles(files: Record<string, string>): void {
  mockedExists.mockImplementation((file: string) => file in files);
  mockedRead.mockImplementation((file: string) => {
    if (file in files) return files[file];
    const error = new Error(`ENOENT: ${file}`) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  });
}

/** A normalized config with only the parts a test cares about filled in. */
function codegenConfig(parts: Partial<CodegenConfig> = {}): CodegenConfig {
  return {
    file: 'codegen.ts',
    documents: [],
    schema: [],
    outputs: [],
    presets: [],
    plugins: [],
    ...parts,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CODEGEN_FILENAMES', () => {
  it('prefers a TypeScript config over YAML, JSON and package.json', () => {
    expect(CODEGEN_FILENAMES.indexOf('codegen.ts')).toBe(0);
    expect(CODEGEN_FILENAMES.indexOf('codegen.ts')).toBeLessThan(
      CODEGEN_FILENAMES.indexOf('codegen.yml'),
    );
    expect(CODEGEN_FILENAMES.indexOf('codegen.yml')).toBeLessThan(
      CODEGEN_FILENAMES.indexOf('codegen.json'),
    );
    expect(CODEGEN_FILENAMES.indexOf('package.json')).toBe(
      CODEGEN_FILENAMES.length - 1,
    );
  });
});

describe('discoverCodegenConfig', () => {
  it('returns not-found when the directory has no codegen config', () => {
    mockFiles({});
    expect(discoverCodegenConfig()).toEqual({
      found: false,
      reason: expect.stringContaining('No GraphQL Code Generator config'),
    });
  });

  it('takes the first filename in order when several exist', () => {
    mockFiles({
      'codegen.ts': "const config = { documents: ['ts/**/*.graphql'] };",
      'codegen.yml': "documents: 'yaml/**/*.graphql'\n",
    });
    const lookup = discoverCodegenConfig();
    expect(lookup.found).toBe(true);
    if (!lookup.found) return;
    expect(lookup.config.file).toBe('codegen.ts');
    expect(lookup.config.documents).toEqual(['ts/**/*.graphql']);
  });

  it('reads a YAML config when no JavaScript config exists', () => {
    mockFiles({
      'codegen.yml': [
        'schema: ./schema.graphql',
        'documents:',
        '  - src/**/*.graphql',
        'generates:',
        '  src/generated/graphql.ts:',
        '    plugins:',
        '      - typescript',
        '      - typescript-react-apollo',
      ].join('\n'),
    });
    const lookup = discoverCodegenConfig();
    expect(lookup.found).toBe(true);
    if (!lookup.found) return;
    expect(lookup.config).toEqual({
      file: 'codegen.yml',
      schema: ['./schema.graphql'],
      documents: ['src/**/*.graphql'],
      outputs: ['src/generated/graphql.ts'],
      presets: [],
      plugins: ['typescript', 'typescript-react-apollo'],
    });
  });

  it('reads a JSON config', () => {
    mockFiles({
      'codegen.json': JSON.stringify({
        documents: 'src/**/*.graphql',
        generates: { 'src/gql/': { preset: 'client' } },
      }),
    });
    const lookup = discoverCodegenConfig();
    expect(lookup.found).toBe(true);
    if (!lookup.found) return;
    expect(lookup.config.file).toBe('codegen.json');
    expect(lookup.config.documents).toEqual(['src/**/*.graphql']);
    expect(lookup.config.outputs).toEqual(['src/gql/']);
    expect(lookup.config.presets).toEqual(['client']);
  });

  it('reads a "codegen" key from package.json', () => {
    mockFiles({
      'package.json': JSON.stringify({
        name: 'demo',
        codegen: { documents: ['src/**/*.graphql'] },
      }),
    });
    const lookup = discoverCodegenConfig();
    expect(lookup.found).toBe(true);
    if (!lookup.found) return;
    expect(lookup.config.file).toBe('package.json');
    expect(lookup.config.documents).toEqual(['src/**/*.graphql']);
  });

  it('ignores non-string entries in a YAML list', () => {
    mockFiles({ 'codegen.yml': 'documents:\n  - 8080\n  - src/*.graphql\n' });
    const lookup = discoverCodegenConfig();
    expect(lookup.found).toBe(true);
    if (!lookup.found) return;
    expect(lookup.config.documents).toEqual(['src/*.graphql']);
  });

  it('ignores a config that is not an object at all', () => {
    mockFiles({ 'codegen.json': '"just a string"' });
    const lookup = discoverCodegenConfig();
    expect(lookup.found).toBe(true);
    if (!lookup.found) return;
    expect(lookup.config.documents).toEqual([]);
  });

  it('ignores a package.json without a "codegen" key', () => {
    mockFiles({ 'package.json': JSON.stringify({ name: 'demo' }) });
    expect(discoverCodegenConfig().found).toBe(false);
  });
});

describe('loadCodegenConfig', () => {
  it('reports an unreadable file rather than throwing', () => {
    mockFiles({});
    expect(loadCodegenConfig('custom/codegen.yml')).toEqual({
      found: false,
      file: 'custom/codegen.yml',
      reason: expect.stringContaining('Could not read'),
    });
  });

  it('reports malformed YAML rather than throwing', () => {
    mockFiles({ 'codegen.yml': 'documents: [' });
    const lookup = loadCodegenConfig('codegen.yml');
    expect(lookup.found).toBe(false);
    if (lookup.found) return;
    expect(lookup.reason).toContain('Could not parse');
  });

  it('reports malformed JSON rather than throwing', () => {
    mockFiles({ 'codegen.json': '{ "documents": ' });
    expect(loadCodegenConfig('codegen.json').found).toBe(false);
  });

  it('treats an empty file as no configuration', () => {
    mockFiles({ 'codegen.yml': '   \n' });
    expect(loadCodegenConfig('codegen.yml').found).toBe(false);
  });

  it('reads a config from an explicit path', () => {
    mockFiles({ 'tools/codegen.yaml': 'documents: src/**/*.graphql\n' });
    const lookup = loadCodegenConfig('tools/codegen.yaml');
    expect(lookup.found).toBe(true);
    if (!lookup.found) return;
    expect(lookup.config.documents).toEqual(['src/**/*.graphql']);
  });
});

describe('extractCodegenFromSource', () => {
  it('reads a typical TypeScript config with the client preset', () => {
    const source = [
      "import type { CodegenConfig } from '@graphql-codegen/cli';",
      '',
      'const config: CodegenConfig = {',
      "  schema: 'https://example.com/graphql',",
      "  documents: ['src/**/*.tsx', '!src/gql/**/*'],",
      '  generates: {',
      "    './src/gql/': {",
      "      preset: 'client',",
      '      plugins: [],',
      '    },',
      '  },',
      '};',
      'export default config;',
    ].join('\n');
    expect(extractCodegenFromSource(source)).toEqual({
      schema: ['https://example.com/graphql'],
      documents: ['src/**/*.tsx', '!src/gql/**/*'],
      outputs: ['./src/gql/'],
      presets: ['client'],
      plugins: [],
    });
  });

  it('reads a single documents string', () => {
    expect(
      extractCodegenFromSource("export default { documents: 'src/**/*.gql' }"),
    ).toMatchObject({ documents: ['src/**/*.gql'] });
  });

  it('reads plugin names given as objects with options', () => {
    const source = [
      'module.exports = {',
      '  generates: {',
      "    'src/generated/graphql.ts': {",
      '      plugins: [',
      "        'typescript',",
      "        { 'typescript-react-apollo': { withHooks: true } },",
      '      ],',
      '    },',
      '  },',
      '};',
    ].join('\n');
    expect(extractCodegenFromSource(source)).toMatchObject({
      outputs: ['src/generated/graphql.ts'],
      plugins: ['typescript', 'typescript-react-apollo'],
    });
  });

  it('skips computed, imported and interpolated values without throwing', () => {
    const source = [
      "import { DOCUMENTS } from './globs';",
      'const outDir = process.env.OUT_DIR;',
      'export default {',
      '  schema: process.env.SCHEMA_URL,',
      "  documents: [DOCUMENTS, `${ROOT}/src/**/*.ts`, 'src/**/*.graphql'],",
      '  generates: {',
      '    [outDir]: { preset: somePreset },',
      "    'src/generated/graphql.ts': { plugins: ['typescript'] },",
      '  },',
      '};',
    ].join('\n');
    expect(extractCodegenFromSource(source)).toEqual({
      schema: [],
      documents: ['src/**/*.graphql'],
      outputs: ['src/generated/graphql.ts'],
      presets: [],
      plugins: ['typescript'],
    });
  });

  it('ignores keys inside comments and strings', () => {
    const source = [
      'export default {',
      "  // documents: 'commented/**/*.graphql',",
      "  /* schema: 'block.graphql', */",
      "  documents: 'real/**/*.graphql',",
      '  note: "documents: \'quoted/**/*.graphql\'",',
      '};',
    ].join('\n');
    expect(extractCodegenFromSource(source)).toMatchObject({
      documents: ['real/**/*.graphql'],
      schema: [],
    });
  });

  it('reads a backtick string with no interpolation in it', () => {
    expect(
      extractCodegenFromSource('export default { documents: `src/**/*.gql` }'),
    ).toMatchObject({ documents: ['src/**/*.gql'] });
  });

  it('keeps an escaped quote inside a value', () => {
    expect(
      extractCodegenFromSource(
        "export default { documents: 'src/o\\'clock/*.gql' }",
      ),
    ).toMatchObject({ documents: ["src/o'clock/*.gql"] });
  });

  it('steps over a value that is a call, keeping the keys after it', () => {
    const source = [
      'export default {',
      '  hooks: { afterAllFileWrite: run("prettier", "--write") },',
      "  documents: 'src/**/*.graphql',",
      '};',
    ].join('\n');
    expect(extractCodegenFromSource(source)).toMatchObject({
      documents: ['src/**/*.graphql'],
    });
  });

  it('reads plugin names out of a nested array', () => {
    expect(
      extractCodegenFromSource("export default { plugins: [['typescript']] }"),
    ).toMatchObject({ plugins: ['typescript'] });
  });

  it('gives up on an unterminated string instead of hanging', () => {
    expect(
      extractCodegenFromSource("export default { documents: 'src/**/*.gql"),
    ).toMatchObject({ documents: [] });
  });

  it('gives up on an unterminated comment instead of hanging', () => {
    expect(
      extractCodegenFromSource(
        "export default { documents: 'a.gql' }; /* trailing",
      ),
    ).toMatchObject({ documents: ['a.gql'] });
  });

  it('reads nothing from a value that spans a line break in a quote', () => {
    expect(
      extractCodegenFromSource("export default { documents: 'src/\n*.gql' }"),
    ).toMatchObject({ documents: [] });
  });

  it('returns empty lists for a file with no configuration at all', () => {
    expect(extractCodegenFromSource('export const answer = 42;')).toEqual({
      schema: [],
      documents: [],
      outputs: [],
      presets: [],
      plugins: [],
    });
  });
});

describe('globToDirectory', () => {
  it.each([
    ['src/**/*.graphql', 'src'],
    ['./src/**/*.{ts,tsx}', './src'],
    ['packages/*/src/**/*.ts', 'packages/*/src'],
    ['src/operations/queries.graphql', 'src/operations'],
    ['src/**', 'src'],
    ['src/*', 'src'],
    ['src', 'src'],
    ['*.graphql', '.'],
  ])('turns %s into %s', (glob, expected) => {
    expect(globToDirectory(glob)).toBe(expected);
  });
});

describe('deriveGqlPruneConfig', () => {
  it('turns document globs into directories to scan', () => {
    expect(
      deriveGqlPruneConfig(
        codegenConfig({ documents: ['src/**/*.graphql', 'app/**/*.graphql'] }),
      ),
    ).toMatchObject({
      graphqlDir: ['src', 'app'],
      srcDir: ['src', 'app'],
    });
  });

  it('de-duplicates directories derived from several globs', () => {
    expect(
      deriveGqlPruneConfig(
        codegenConfig({ documents: ['src/**/*.graphql', 'src/**/*.gql'] }),
      ),
    ).toMatchObject({ graphqlDir: ['src'] });
  });

  it('turns negated document globs into exclude patterns', () => {
    expect(
      deriveGqlPruneConfig(
        codegenConfig({ documents: ['src/**/*.tsx', '!src/gql/**/*'] }),
      ),
    ).toMatchObject({ exclude: ['src/gql/**/*'] });
  });

  it('excludes the generated output files and directories', () => {
    expect(
      deriveGqlPruneConfig(
        codegenConfig({
          outputs: ['./src/gql/', 'src/generated/graphql.ts'],
        }),
      ),
    ).toMatchObject({ exclude: ['src/gql', 'src/generated/graphql.ts'] });
  });

  it('suggests the inline scan when documents live in source files', () => {
    expect(
      deriveGqlPruneConfig(codegenConfig({ documents: ['src/**/*.{ts,tsx}'] })),
    ).toMatchObject({ inline: true });
  });

  it('leaves the inline scan off for .graphql documents', () => {
    expect(
      deriveGqlPruneConfig(codegenConfig({ documents: ['src/**/*.graphql'] })),
    ).not.toHaveProperty('inline');
  });

  it('takes a local SDL file as schemaFile', () => {
    expect(
      deriveGqlPruneConfig(codegenConfig({ schema: ['./schema.graphql'] })),
    ).toMatchObject({ schemaFile: './schema.graphql' });
  });

  it.each([
    ['https://example.com/graphql'],
    ['http://localhost:4000/graphql'],
    ['${SCHEMA_URL}/graphql'],
    ['src/schema/*.graphql'],
    ['schema.json'],
    ['src/schema.ts'],
  ])('ignores %s as a schema file', (schema) => {
    expect(
      deriveGqlPruneConfig(codegenConfig({ schema: [schema] })),
    ).not.toHaveProperty('schemaFile');
  });

  it('prefers the first local SDL file when a URL comes first', () => {
    expect(
      deriveGqlPruneConfig(
        codegenConfig({
          schema: ['https://example.com/graphql', 'schema.graphql'],
        }),
      ),
    ).toMatchObject({ schemaFile: 'schema.graphql' });
  });

  it('derives nothing at all from an empty config', () => {
    expect(deriveGqlPruneConfig(codegenConfig())).toEqual({});
  });

  it('leaves the default patterns alone for an unrecognized plugin', () => {
    const derived = deriveGqlPruneConfig(
      codegenConfig({ plugins: ['typescript', 'some-unknown-plugin'] }),
    );
    expect(derived).not.toHaveProperty('usagePatterns');
    expect(derived).not.toHaveProperty('fragmentUsagePatterns');
  });

  it('leaves the default patterns alone for the near-operation-file preset', () => {
    // It only moves the output files; the generated names are unchanged.
    expect(
      deriveGqlPruneConfig(codegenConfig({ presets: ['near-operation-file'] })),
    ).not.toHaveProperty('usagePatterns');
  });

  it('derives inline scanning (not a naming pattern) from the client preset', () => {
    const derived = deriveGqlPruneConfig(
      codegenConfig({ presets: ['client'] }),
    );
    expect(derived).toMatchObject({ inline: true });
    expect(derived).not.toHaveProperty('usagePatterns');
  });

  it('recognizes a preset written as its full package name', () => {
    expect(
      deriveGqlPruneConfig(
        codegenConfig({ presets: ['@graphql-codegen/client-preset'] }),
      ),
    ).toMatchObject({ inline: true });
  });

  it('replaces (never extends) the built-in patterns when a plugin is mapped', () => {
    const derived = deriveGqlPruneConfig(
      codegenConfig({ plugins: ['typescript-apollo-angular'] }),
    );
    expect(derived.usagePatterns).toEqual(['{Name}GQL', '{Name}Document']);
    expect(derived.usagePatterns).not.toEqual(
      expect.arrayContaining(['use{Name}Lazy{Type}']),
    );
  });

  it('unions the patterns of several mapped plugins', () => {
    const derived = deriveGqlPruneConfig(
      codegenConfig({
        plugins: ['typescript-react-apollo', 'typescript-apollo-angular'],
      }),
    );
    expect(derived.usagePatterns).toEqual(
      expect.arrayContaining(['use{Name}{Type}', '{Name}GQL']),
    );
    // De-duplicated: both plugins emit the document constant.
    expect(
      derived.usagePatterns?.filter((p) => p === '{Name}Document'),
    ).toHaveLength(1);
  });

  describe.each(CODEGEN_PATTERN_MAPPINGS.map((m) => [m.name, m] as const))(
    'mapping for %s',
    (_name, mapping) => {
      it('derives at least one setting', () => {
        const derived = deriveGqlPruneConfig(
          codegenConfig(
            mapping.kind === 'preset'
              ? { presets: [mapping.name] }
              : { plugins: [mapping.name] },
          ),
        );
        expect(Object.keys(derived).length).toBeGreaterThan(0);
      });

      it('uses only supported placeholders in its patterns', () => {
        const patterns = [
          ...(mapping.usagePatterns ?? []),
          ...(mapping.fragmentUsagePatterns ?? []),
        ];
        for (const pattern of patterns) {
          expect(pattern.replace(/\{(name|Name|type|Type)\}/g, '')).not.toMatch(
            /[{}]/,
          );
        }
      });

      it('never maps to a bare operation name, which would match anything', () => {
        for (const pattern of mapping.usagePatterns ?? []) {
          expect(['{name}', '{Name}']).not.toContain(pattern);
        }
      });
    },
  );

  it('keeps the built-in defaults out of the derived values', () => {
    // The derivation replaces the defaults; it never re-states them.
    const derived = deriveGqlPruneConfig(
      codegenConfig({ documents: ['src/**/*.graphql'] }),
    );
    expect(derived.usagePatterns).toBeUndefined();
    expect(DEFAULT_USAGE_PATTERNS.length).toBeGreaterThan(0);
    expect(DEFAULT_FRAGMENT_USAGE_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe('formatCodegenInfoLine', () => {
  it('names the file and the settings that came from it', () => {
    const line = formatCodegenInfoLine({
      file: 'codegen.ts',
      values: { graphqlDir: ['src'], srcDir: ['src'], inline: true },
    });
    expect(line).toContain('codegen.ts');
    expect(line).toContain('graphqlDir');
    expect(line).toContain('srcDir');
    expect(line).toContain('inline');
  });
});

describe('formatCodegenVerboseLines', () => {
  it('lists every derived value', () => {
    expect(
      formatCodegenVerboseLines({
        file: 'codegen.yml',
        values: {
          graphqlDir: ['src', 'app'],
          exclude: ['src/gql'],
          schemaFile: './schema.graphql',
          inline: true,
        },
      }),
    ).toEqual([
      'codegen config: codegen.yml',
      'codegen graphqlDir: src, app',
      'codegen exclude: src/gql',
      'codegen schemaFile: ./schema.graphql',
      'codegen inline: true',
    ]);
  });

  it('names the file even when nothing was derived', () => {
    expect(
      formatCodegenVerboseLines({ file: 'codegen.ts', values: {} }),
    ).toEqual(['codegen config: codegen.ts']);
  });
});
