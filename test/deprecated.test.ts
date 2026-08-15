// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { buildSchema, parse, Source } from 'graphql';
import { findDeprecatedUsages } from '../src/utils/deprecated';
import { GraphqlFileEntities } from '../src/utils/operations';

const schema = buildSchema(`
  enum Color {
    RED @deprecated(reason: "use BLUE")
    BLUE
  }

  type User {
    id: ID!
    nickname: String @deprecated(reason: "use displayName")
    displayName: String
  }

  type Query {
    user: User
    usersByColor(color: Color!): [User!]!
  }
`);

/** A parsed gql file carrying only the document the detector reads. */
const parsedFile = (
  filePath: string,
  content: string,
): GraphqlFileEntities => ({
  operations: [],
  fragments: [],
  operationSpreads: [],
  fragmentSpreads: [],
  document: parse(new Source(content, filePath)),
});

describe('findDeprecatedUsages', () => {
  it('flags a selected deprecated field with its file and line', () => {
    const usages = findDeprecatedUsages(schema, [
      parsedFile(
        'graphql/user.gql',
        'query GetUser {\n  user {\n    nickname\n  }\n}',
      ),
    ]);
    expect(usages).toHaveLength(1);
    expect(usages[0].file).toBe('graphql/user.gql');
    expect(usages[0].line).toBe(3);
    expect(usages[0].message).toContain('User.nickname');
    expect(usages[0].message).toContain('use displayName');
  });

  it('flags a deprecated enum value used as an argument', () => {
    const usages = findDeprecatedUsages(schema, [
      parsedFile(
        'graphql/color.gql',
        'query Reds {\n  usersByColor(color: RED) {\n    id\n  }\n}',
      ),
    ]);
    expect(usages).toHaveLength(1);
    expect(usages[0].file).toBe('graphql/color.gql');
    expect(usages[0].line).toBe(2);
    expect(usages[0].message).toContain('Color.RED');
  });

  it('returns [] when nothing deprecated is selected', () => {
    const usages = findDeprecatedUsages(schema, [
      parsedFile(
        'graphql/user.gql',
        'query GetUser {\n  user {\n    displayName\n  }\n}',
      ),
    ]);
    expect(usages).toEqual([]);
  });

  it('resolves a fragment defined in another file and reports it at its own location', () => {
    const usages = findDeprecatedUsages(schema, [
      parsedFile(
        'graphql/query.gql',
        'query GetUser {\n  user {\n    ...UserFields\n  }\n}',
      ),
      parsedFile(
        'graphql/fragments.gql',
        'fragment UserFields on User {\n  nickname\n}',
      ),
    ]);
    expect(usages).toHaveLength(1);
    expect(usages[0].file).toBe('graphql/fragments.gql');
    expect(usages[0].line).toBe(2);
  });

  it('ignores fields the schema does not define instead of crashing', () => {
    const usages = findDeprecatedUsages(schema, [
      parsedFile(
        'graphql/user.gql',
        'query GetUser {\n  user {\n    notInSchema\n  }\n}',
      ),
    ]);
    expect(usages).toEqual([]);
  });

  it('skips files that failed to parse', () => {
    const unparsed: GraphqlFileEntities = {
      operations: [],
      fragments: [],
      operationSpreads: [],
      fragmentSpreads: [],
      document: null,
    };
    const usages = findDeprecatedUsages(schema, [
      unparsed,
      parsedFile(
        'graphql/user.gql',
        'query GetUser {\n  user {\n    nickname\n  }\n}',
      ),
    ]);
    expect(usages).toHaveLength(1);
    expect(usages[0].file).toBe('graphql/user.gql');
  });

  it('returns [] when no file parsed at all', () => {
    expect(
      findDeprecatedUsages(schema, [
        {
          operations: [],
          fragments: [],
          operationSpreads: [],
          fragmentSpreads: [],
          document: null,
        },
      ]),
    ).toEqual([]);
  });
});
