// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { OperationDefinitionNode, parse, Source } from 'graphql';
import { buildGraphqlEntities } from '../src/utils/operations';
import {
  buildSelectionTree,
  collectFragmentDefinitions,
  SelectionNode,
  selectionNodes,
} from '../src/utils/selectionTree';

/** Parses one document per file and returns the entities a scan would hold. */
const entitiesOf = (files: Record<string, string>) =>
  Object.entries(files).map(([file, text]) =>
    buildGraphqlEntities(parse(new Source(text, file)), file),
  );

/** The tree of the named operation, with every file's fragments merged in. */
const treeOf = (files: Record<string, string>, name: string) => {
  const entities = entitiesOf(files);
  const fragments = collectFragmentDefinitions(entities);
  for (const entity of entities) {
    for (const definition of entity.document?.definitions ?? []) {
      if (
        definition.kind === 'OperationDefinition' &&
        definition.name?.value === name
      ) {
        return buildSelectionTree(
          definition as OperationDefinitionNode,
          entity.filePath,
          fragments,
        );
      }
    }
  }
  throw new Error(`no operation ${name}`);
};

/** Every node as `path @ file:line, ...`, depth first. */
const describeTree = (root: SelectionNode): string[] =>
  selectionNodes(root).map(
    (node) =>
      `${node.path.join('.')} @ ${node.locations
        .map((location) => `${location.file}:${location.line}`)
        .join(', ')}`,
  );

describe('collectFragmentDefinitions', () => {
  it('keys every fragment by name, keeping each definition and its file', () => {
    const fragments = collectFragmentDefinitions(
      entitiesOf({
        'a.gql': 'fragment A on User { id }',
        'b.gql': 'fragment A on User { name }\nfragment B on User { id }',
      }),
    );

    expect([...fragments.keys()]).toEqual(['A', 'B']);
    expect(fragments.get('A')?.map((entry) => entry.file)).toEqual([
      'a.gql',
      'b.gql',
    ]);
  });

  it('skips a file that failed to parse', () => {
    expect(
      collectFragmentDefinitions([
        { ...entitiesOf({ 'a.gql': 'query Q { id }' })[0], document: null },
      ]).size,
    ).toBe(0);
  });
});

describe('buildSelectionTree', () => {
  it('builds one node per response key, with its path and location', () => {
    const root = treeOf(
      { 'q.gql': 'query GetUser {\n  user {\n    id\n    name\n  }\n}' },
      'GetUser',
    );

    expect(root.path).toEqual([]);
    expect(describeTree(root)).toEqual([
      'user @ q.gql:2',
      'user.id @ q.gql:3',
      'user.name @ q.gql:4',
    ]);
  });

  it('keys an aliased field by its alias', () => {
    const root = treeOf(
      {
        'q.gql':
          'query GetUser {\n  me: user {\n    picture: avatarUrl\n  }\n}',
      },
      'GetUser',
    );

    expect(describeTree(root)).toEqual([
      'me @ q.gql:2',
      'me.picture @ q.gql:3',
    ]);
  });

  it('skips __typename', () => {
    const root = treeOf(
      { 'q.gql': 'query GetUser {\n  user {\n    __typename\n    id\n  }\n}' },
      'GetUser',
    );

    expect(describeTree(root)).toEqual(['user @ q.gql:2', 'user.id @ q.gql:4']);
  });

  it('merges a fragment spread in place, located in the fragment file', () => {
    const root = treeOf(
      {
        'q.gql': 'query GetUser {\n  user {\n    ...UserFields\n    id\n  }\n}',
        'f.gql': 'fragment UserFields on User {\n  id\n  name\n}',
      },
      'GetUser',
    );

    // `id` is selected twice, so it keeps both places it is selected in.
    expect(describeTree(root)).toEqual([
      'user @ q.gql:2',
      'user.id @ f.gql:2, q.gql:4',
      'user.name @ f.gql:3',
    ]);
  });

  it('merges nested fragment spreads and inline fragments', () => {
    const root = treeOf(
      {
        'q.gql': [
          'query GetNode {',
          '  node {',
          '    ... on User {',
          '      ...Outer',
          '    }',
          '  }',
          '}',
          'fragment Outer on User {',
          '  ...Inner',
          '  name',
          '}',
          'fragment Inner on User {',
          '  address {',
          '    city',
          '  }',
          '}',
        ].join('\n'),
      },
      'GetNode',
    );

    expect(describeTree(root)).toEqual([
      'node @ q.gql:2',
      'node.address @ q.gql:13',
      'node.address.city @ q.gql:14',
      'node.name @ q.gql:10',
    ]);
  });

  it('merges the selections of a key selected in two places', () => {
    const root = treeOf(
      {
        'q.gql': [
          'query GetUser {',
          '  user {',
          '    id',
          '  }',
          '  user {',
          '    name',
          '  }',
          '}',
        ].join('\n'),
      },
      'GetUser',
    );

    expect(describeTree(root)).toEqual([
      'user @ q.gql:2, q.gql:5',
      'user.id @ q.gql:3',
      'user.name @ q.gql:6',
    ]);
  });

  it('stops at a fragment cycle and ignores a fragment it cannot find', () => {
    const root = treeOf(
      {
        'q.gql': [
          'query GetUser {',
          '  user {',
          '    ...A',
          '    ...Missing',
          '  }',
          '}',
          'fragment A on User {',
          '  id',
          '  ...B',
          '}',
          'fragment B on User {',
          '  name',
          '  ...A',
          '}',
        ].join('\n'),
      },
      'GetUser',
    );

    expect(describeTree(root)).toEqual([
      'user @ q.gql:2',
      'user.id @ q.gql:8',
      'user.name @ q.gql:12',
    ]);
  });
});
