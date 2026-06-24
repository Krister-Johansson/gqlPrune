import * as fs from 'fs';
import * as path from 'path';

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
) as { name: string; bin: string | Record<string, string> };

describe('package.json', () => {
  it('names the CLI bin exactly after the package', () => {
    // Regression guard for the v1 → v2 miss: the docs and package name were
    // `gqlprune` while the bin key was `gqlPrune`, so a Linux global install
    // exposed a differently-cased command. The bin name must equal the package
    // name. (A string `bin` is implicitly named after the package.)
    const binNames =
      typeof pkg.bin === 'string' ? [pkg.name] : Object.keys(pkg.bin);
    expect(binNames).toEqual([pkg.name]);
  });
});
