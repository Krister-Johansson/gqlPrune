export type OperationInfo = {
  name: string;
  type: 'query' | 'mutation' | 'subscription';
  filePath: string;
};
