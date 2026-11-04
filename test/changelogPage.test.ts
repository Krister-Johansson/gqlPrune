// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  escapeMdx,
  parseChangelog,
  renderChangelogPage,
} from '../scripts/changelogPage.cjs';

const CHANGELOG = [
  '# Changelog',
  '',
  'All notable changes to this project will be documented in this file.',
  '',
  '## [2.0.0](https://example.com/compare/v1.1.0...v2.0.0) (2026-06-24)',
  '',
  '',
  '### ⚠ BREAKING CHANGES',
  '',
  '* requires Node.js >= 20.',
  '',
  '### Features',
  '',
  '* report `{ file, confidence }` objects ([#1](https://example.com/1))',
  '',
  '### [1.1.4](https://example.com/compare/v1.1.3...v1.1.4) (2023-10-21)',
  '',
  '',
  '### Bug Fixes',
  '',
  '* made publish work',
  '',
  '## 1.0.0 (2023-10-01)',
  '',
  '* first release',
  '',
].join('\n');

describe('escapeMdx', () => {
  it('escapes braces and angle brackets in prose', () => {
    expect(escapeMdx('use{Name}Query and <Foo> here')).toBe(
      'use\\{Name\\}Query and \\<Foo> here',
    );
  });

  it('leaves code spans untouched', () => {
    expect(escapeMdx('a `{ file }` b {c}')).toBe('a `{ file }` b \\{c\\}');
  });

  it('matches code spans by backtick run length', () => {
    expect(escapeMdx('``a ` {b}`` {c}')).toBe('``a ` {b}`` \\{c\\}');
  });

  it('escapes the rest of a line after an unclosed backtick', () => {
    expect(escapeMdx('a ` {b}')).toBe('a ` \\{b\\}');
  });

  it('leaves a line without special characters alone', () => {
    expect(escapeMdx('* requires Node.js >= 20.')).toBe(
      '* requires Node.js >= 20.',
    );
  });
});

describe('parseChangelog', () => {
  const releases = parseChangelog(CHANGELOG);

  it('finds every release, newest first, at either heading level', () => {
    expect(releases.map((release) => release.version)).toEqual([
      '2.0.0',
      '1.1.4',
      '1.0.0',
    ]);
  });

  it('reads the date of each release', () => {
    expect(releases.map((release) => release.date)).toEqual([
      '2026-06-24',
      '2023-10-21',
      '2023-10-01',
    ]);
  });

  it('keeps the lines between one release heading and the next', () => {
    expect(releases[1].lines).toEqual([
      '',
      '',
      '### Bug Fixes',
      '',
      '* made publish work',
      '',
    ]);
  });

  it('drops the title and intro above the first release', () => {
    expect(releases[0].lines.join('\n')).not.toContain('All notable');
  });

  it('throws when it finds no release heading', () => {
    expect(() => parseChangelog('# Changelog\n\nNothing yet.\n')).toThrow(
      /no release headings/,
    );
  });
});

describe('renderChangelogPage', () => {
  const page = renderChangelogPage(CHANGELOG);

  it('starts with frontmatter that has a title and a description', () => {
    expect(page.startsWith('---\ntitle: Changelog\ndescription: ')).toBe(true);
  });

  it('wraps each release in an Update with the version and date', () => {
    expect(page).toContain('<Update label="2.0.0" description="2026-06-24">');
    expect(page).toContain('<Update label="1.1.4" description="2023-10-21">');
    expect(page).toContain('<Update label="1.0.0" description="2023-10-01">');
    expect(page.match(/<Update /g)).toHaveLength(3);
    expect(page.match(/<\/Update>/g)).toHaveLength(3);
  });

  it('turns section headings into bold lines', () => {
    expect(page).toContain('**⚠ BREAKING CHANGES**');
    expect(page).toContain('**Bug Fixes**');
    const body = page.slice(page.indexOf('\n---\n') + 5);
    expect(body).not.toMatch(/^#{1,6} /m);
  });

  it('keeps code spans and escapes prose', () => {
    expect(page).toContain('`{ file, confidence }`');
  });

  it('collapses runs of blank lines', () => {
    expect(page).not.toContain('\n\n\n');
  });

  it('ends with a single newline', () => {
    expect(page.endsWith('</Update>\n')).toBe(true);
  });

  it('leaves fenced code blocks untouched', () => {
    const fenced = renderChangelogPage(
      '## 1.0.0 (2023-10-01)\n\n```yaml\nkey: {a}\n```\n\n* {b}\n',
    );
    expect(fenced).toContain('```yaml\nkey: {a}\n```');
    expect(fenced).toContain('* \\{b\\}');
  });
});

describe('docs/changelog.mdx', () => {
  const root = join(__dirname, '..');
  const read = (path: string) => readFileSync(join(root, path), 'utf8');

  // release-please updates CHANGELOG.md in the release PR, and the
  // changelog-page job in release-please.yml regenerates the page on the same
  // branch. A release PR whose page did not follow fails here.
  it('matches CHANGELOG.md (run node scripts/changelogPage.cjs)', () => {
    expect(read('docs/changelog.mdx')).toBe(
      renderChangelogPage(read('CHANGELOG.md')),
    );
  });

  it('is in the docs navigation', () => {
    const nav = JSON.parse(read('docs/docs.json')).navigation.groups;
    const pages = nav.flatMap((group: { pages: string[] }) => group.pages);
    expect(pages).toContain('changelog');
  });
});
