import * as fs from 'fs';
import inquirer from 'inquirer';
import { generateConfig, splitFolders } from '../src/core/configGenerator';

jest.mock('fs');
jest.mock('inquirer', () => ({
  __esModule: true,
  default: { prompt: jest.fn() },
}));

describe('configGenerator', () => {
  describe('splitFolders', () => {
    it('splits and trims a comma-separated list', () => {
      expect(splitFolders('node_modules, dist ,  __generated__')).toEqual([
        'node_modules',
        'dist',
        '__generated__',
      ]);
    });

    it('returns a single-element list for one folder', () => {
      expect(splitFolders('node_modules')).toEqual(['node_modules']);
    });
  });

  describe('generateConfig', () => {
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.clearAllMocks();
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => logSpy.mockRestore());

    it('prompts the user and writes the answers as YAML', async () => {
      (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({
        graphqlDir: './graphql',
        srcDir: './src',
        excludedFolders: ['node_modules'],
      });

      await generateConfig();

      expect(inquirer.prompt).toHaveBeenCalledTimes(1);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      const [file, contents] = (fs.writeFileSync as jest.Mock).mock.calls[0];
      expect(file).toBe('./gqlPrune.config.yaml');
      expect(contents).toContain('graphqlDir: ./graphql');
      expect(contents).toContain('srcDir: ./src');
      expect(logSpy.mock.calls.flat().join('\n')).toContain(
        'Configuration generated',
      );
    });
  });
});
