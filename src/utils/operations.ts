import * as fs from 'fs';
import { ASTNode, parse, visit } from 'graphql';
import { OperationInfo } from '../types/OperationInfo.js';
import { FragmentInfo } from '../types/FragmentInfo.js';

export type GraphqlFileEntities = {
  operations: OperationInfo[];
  fragments: FragmentInfo[];
  /** Names of fragments spread (directly or nested) by operations in the file. */
  operationSpreads: string[];
  /** Per-fragment direct fragment-spread dependencies. */
  fragmentSpreads: { name: string; spreads: string[] }[];
};

/**
 * Returns the names of all fragment spreads (`...Name`) within a node, including
 * those nested in sub-selections and inline fragments. De-duplicated.
 *
 * @param {ASTNode} node - A parsed GraphQL AST node (operation or fragment).
 * @returns {string[]} - The fragment-spread names found within the node.
 */
export function getFragmentSpreads(node: ASTNode): string[] {
  const names = new Set<string>();
  visit(node, {
    FragmentSpread(spread) {
      names.add(spread.name.value);
    },
  });
  return [...names];
}

/**
 * Parses a GraphQL file and extracts its named operations, fragment
 * definitions, and the fragment-spread edges between them. Schema-free.
 *
 * @param {string} filePath - The path to the GraphQL file.
 * @returns {GraphqlFileEntities} - Operations, fragments, and spread edges.
 */
export function extractGraphqlEntities(filePath: string): GraphqlFileEntities {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ast = parse(content);
    const operations: OperationInfo[] = [];
    const fragments: FragmentInfo[] = [];
    const operationSpreads = new Set<string>();
    const fragmentSpreads: { name: string; spreads: string[] }[] = [];

    ast.definitions.forEach((definition) => {
      if (definition.kind === 'OperationDefinition') {
        if (definition.name) {
          operations.push({
            name: definition.name.value,
            type: definition.operation,
            filePath,
          });
        }
        // Spreads from every operation (named or anonymous) keep their
        // fragments alive, so they all count as reachability roots.
        getFragmentSpreads(definition).forEach((s) => operationSpreads.add(s));
      } else if (definition.kind === 'FragmentDefinition') {
        fragments.push({ name: definition.name.value, filePath });
        fragmentSpreads.push({
          name: definition.name.value,
          spreads: getFragmentSpreads(definition),
        });
      }
    });

    return {
      operations,
      fragments,
      operationSpreads: [...operationSpreads],
      fragmentSpreads,
    };
  } catch (error) {
    console.error(`Error parsing GraphQL file: ${filePath}`);
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    return {
      operations: [],
      fragments: [],
      operationSpreads: [],
      fragmentSpreads: [],
    };
  }
}

/**
 * Extracts GraphQL operations (queries, mutations, subscriptions) from a file.
 *
 * @param {string} filePath - The path to the GraphQL file.
 * @returns {OperationInfo[]} - The named operations defined in the file.
 */
export function extractOperations(filePath: string): OperationInfo[] {
  return extractGraphqlEntities(filePath).operations;
}
