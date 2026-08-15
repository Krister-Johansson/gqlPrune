// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import {
  concatAST,
  DocumentNode,
  GraphQLSchema,
  NoDeprecatedCustomRule,
  validate,
} from 'graphql';
import { GraphqlFileEntities } from './operations.js';

/** One selection of a `@deprecated` schema field or enum value. */
export type DeprecatedUsage = {
  /** The validator's message, e.g. `The field User.name is deprecated. ...`. */
  message: string;
  /** The `.gql`/`.graphql` file the selection lives in. */
  file: string;
  /** The line within that file; absent when the location is unknown. */
  line?: number;
};

/**
 * Finds every selection of a field or enum value that the given schema marks
 * `@deprecated`. Opt-in: callers only build a schema when the user configured
 * one, so the default scan stays schema-free.
 *
 * The whole corpus is concatenated into a single document before validation, so
 * a fragment spread resolves even when the fragment is defined in another file.
 * Only the deprecation rule runs, so unknown fields, duplicate names and other
 * mismatches between the corpus and the schema are ignored rather than reported
 * as noise. Findings are located by the source name each document was parsed
 * with (see `extractGraphqlEntities`), which is the file path.
 *
 * @param {GraphQLSchema} schema - The schema built from the configured SDL.
 * @param {GraphqlFileEntities[]} parsedFiles - One parsed entry per gql file.
 * @returns {DeprecatedUsage[]} - One entry per deprecated selection.
 */
export function findDeprecatedUsages(
  schema: GraphQLSchema,
  parsedFiles: GraphqlFileEntities[],
): DeprecatedUsage[] {
  const documents = parsedFiles
    .map((file) => file.document)
    .filter((document): document is DocumentNode => document !== null);
  if (documents.length === 0) {
    return [];
  }

  return validate(schema, concatAST(documents), [NoDeprecatedCustomRule]).map(
    (error) => ({
      message: error.message,
      file: error.source?.name ?? '',
      line: error.locations?.[0]?.line,
    }),
  );
}
