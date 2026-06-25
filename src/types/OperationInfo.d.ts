export type OperationInfo = {
  name: string;
  type: 'query' | 'mutation' | 'subscription';
  filePath: string;
  /** 1-based line of the operation definition within its source file. */
  line?: number;
};
