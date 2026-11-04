// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// Writes docs/changelog.mdx, the changelog page of the user docs, from
// CHANGELOG.md. release-please owns CHANGELOG.md and Docs7 builds only the
// docs/ folder, so the page is a generated copy. The changelog-page job in
// release-please.yml runs this on the release PR branch, which puts the page
// in the release commit that docs-live moves to. test/changelogPage.test.ts
// fails when the two files drift apart.
//
// Usage: node scripts/changelogPage.cjs
//
// CommonJS with no dependencies, so the workflow runs it with plain node and
// no install or build.

const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * A release heading as release-please and standard-version write it, at level
 * 2 or 3, with or without a compare link: `## [4.1.1](url) (2026-11-03)` or
 * `## 1.0.0 (2023-10-01)`.
 */
const RELEASE_HEADING =
  /^#{2,3} \[?(\d+\.\d+\.\d+[^\]\s(]*)\]?(?:\([^)]*\))? \((\d{4}-\d{2}-\d{2})\)\s*$/;

const FENCE = /^\s*(```|~~~)/;

const FRONTMATTER = [
  '---',
  'title: Changelog',
  'description: Every gqlPrune release with its breaking changes, features and fixes, newest first.',
  '# Generated from CHANGELOG.md by scripts/changelogPage.cjs. Do not edit by',
  '# hand: the release-please workflow regenerates it on each release PR.',
  '---',
  '',
  'Each entry lists the commits that went into one gqlPrune release. The [upgrade guides](/migration/v4) walk through the breaking changes of each major version.',
  '',
];

/**
 * Escapes the characters MDX would read as JSX or an expression (`{`, `}` and
 * `<`) in one line of Markdown, outside its code spans. A code span closes
 * only on a backtick run of the same length; an unclosed run is plain text.
 *
 * @param {string} line
 * @returns {string}
 */
function escapeMdx(line) {
  const escapeProse = (text) => text.replace(/[{}<]/g, (char) => `\\${char}`);
  let out = '';
  let index = 0;
  while (index < line.length) {
    const open = line.indexOf('`', index);
    if (open === -1) break;
    let runEnd = open;
    while (line[runEnd] === '`') runEnd++;
    const run = line.slice(open, runEnd);
    const close = findRun(line, run, runEnd);
    if (close === -1) break;
    out += escapeProse(line.slice(index, open)) + line.slice(open, close);
    index = close;
  }
  return out + escapeProse(line.slice(index));
}

/**
 * The index just past the next backtick run in `line` that is exactly `run`,
 * searching from `from`, or -1 when there is none.
 *
 * @param {string} line
 * @param {string} run
 * @param {number} from
 * @returns {number}
 */
function findRun(line, run, from) {
  let index = from;
  while (index < line.length) {
    const start = line.indexOf('`', index);
    if (start === -1) return -1;
    let end = start;
    while (line[end] === '`') end++;
    if (end - start === run.length) return end;
    index = end;
  }
  return -1;
}

/**
 * Splits a changelog into its releases, newest first as the file lists them.
 * Everything above the first release heading (the title and intro) is
 * dropped. Throws when no heading matches, so a change in the changelog
 * format fails loudly instead of emptying the page.
 *
 * @param {string} markdown
 * @returns {{ version: string, date: string, lines: string[] }[]}
 */
function parseChangelog(markdown) {
  /** @type {{ version: string, date: string, lines: string[] }[]} */
  const releases = [];
  for (const line of markdown.split('\n')) {
    const heading = RELEASE_HEADING.exec(line);
    if (heading) {
      releases.push({ version: heading[1], date: heading[2], lines: [] });
    } else if (releases.length > 0) {
      releases[releases.length - 1].lines.push(line);
    }
  }
  if (releases.length === 0) {
    throw new Error('CHANGELOG.md has no release headings to render');
  }
  return releases;
}

/**
 * Renders the body lines of one release: section headings become bold lines
 * (so the page's table of contents lists releases, not a "Bug Fixes" per
 * release), prose is escaped for MDX, fenced code is copied as is.
 *
 * @param {string[]} lines
 * @returns {string[]}
 */
function renderBody(lines) {
  const out = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      out.push(line);
    } else if (inFence) {
      out.push(line);
    } else {
      const heading = /^#{1,6} (.*)$/.exec(line);
      out.push(heading ? `**${escapeMdx(heading[1].trim())}**` : escapeMdx(line));
    }
  }
  return out;
}

/**
 * The whole docs/changelog.mdx page for a changelog: frontmatter, a short
 * intro, then one `<Update>` per release labelled with its version.
 *
 * @param {string} markdown
 * @returns {string}
 */
function renderChangelogPage(markdown) {
  const out = [...FRONTMATTER];
  for (const release of parseChangelog(markdown)) {
    out.push(
      `<Update label="${release.version}" description="${release.date}">`,
      '',
      ...renderBody(release.lines),
      '',
      '</Update>',
      '',
    );
  }
  return (
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  );
}

module.exports = { escapeMdx, parseChangelog, renderChangelogPage };

if (require.main === module) {
  const root = join(__dirname, '..');
  const page = renderChangelogPage(
    readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
  );
  writeFileSync(join(root, 'docs', 'changelog.mdx'), page);
}
