import * as fs from 'fs';
import { parse } from 'graphql';
import { OperationInfo } from '../types/OperationInfo.js';

/**
 * Extracts GraphQL operations (queries, mutations, etc.) from a given file.
 *
 * @param {string} filePath - The path to the GraphQL file.
 * @returns {OperationInfo[]} - An array of extracted operations with their name, type, and file path.
 */
export function extractOperations(filePath: string): OperationInfo[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ast = parse(content);
    const operations: OperationInfo[] = [];

    ast.definitions.forEach((definition) => {
      if (definition.kind === 'OperationDefinition' && definition.name) {
        operations.push({
          name: definition.name.value,
          type: definition.operation,
          filePath,
        });
      }
    });

    return operations;
  } catch (error) {
    console.error(`Error parsing GraphQL file: ${filePath}`);
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    return [];
  }
}
