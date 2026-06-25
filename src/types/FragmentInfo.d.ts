export type FragmentInfo = {
  name: string;
  filePath: string;
  /** 1-based line of the fragment definition within its source file. */
  line?: number;
};
