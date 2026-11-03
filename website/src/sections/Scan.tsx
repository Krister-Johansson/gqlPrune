// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Terminal } from '../components/Terminal';

type Line = { delay: number; className?: string; content: ReactNode };

const high = <span className="hi">high</span>;

// Recorded from test/fixtures/e2e/app with
// `node dist/cli.js --graphql graphql --src src`. Column spacing sits in
// string literals because JSX text collapses runs of spaces. Delays are seconds after the
// recording starts; the command types first.
const LINES: Line[] = [
  { delay: 1.9, className: 'dim', content: 'Found 5 GraphQL files.' },
  { delay: 1.99, className: 'dim', content: 'Found 3 GraphQL operations.' },
  { delay: 2.08, className: 'dim', content: 'Found 2 source files.' },
  { delay: 2.17, content: ' ' },
  {
    delay: 2.26,
    className: 'hd',
    content: '--- Unused GraphQL Operations ---',
  },
  { delay: 2.58, content: ' ' },
  {
    delay: 2.67,
    className: 'dim',
    content: 'Type  Operation       Confidence File',
  },
  {
    delay: 2.76,
    content: (
      <>
        {'query GetLegacyReport '}
        {high}
        {'       legacyReport.gql'}
      </>
    ),
  },
  {
    delay: 2.85,
    className: 'dim',
    content: '---------------------------------',
  },
  {
    delay: 2.94,
    content: 'Found 1 unused GraphQL operation. Please remove it.',
  },
  { delay: 3.03, content: ' ' },
  { delay: 3.12, className: 'hd', content: '--- Unused GraphQL Fragments ---' },
  { delay: 3.44, content: ' ' },
  {
    delay: 3.53,
    className: 'dim',
    content: 'Fragment              Confidence File',
  },
  {
    delay: 3.62,
    content: (
      <>
        {'AbandonedTeaserFields '}
        {high}
        {'       teaserFields.gql'}
      </>
    ),
  },
  {
    delay: 3.71,
    className: 'dim',
    content: '--------------------------------',
  },
  { delay: 3.8, content: 'Found 1 unused GraphQL fragment. Please remove it.' },
  { delay: 3.89, content: ' ' },
  { delay: 3.98, className: 'hd', content: '--- Orphaned GraphQL Files ---' },
  { delay: 4.3, content: ' ' },
  { delay: 4.39, className: 'dim', content: 'Confidence File' },
  {
    delay: 4.48,
    content: (
      <>
        {high}
        {'       graphql/legacyReport.gql'}
      </>
    ),
  },
  { delay: 4.57, className: 'dim', content: '------------------------------' },
  {
    delay: 4.66,
    content:
      'Found 1 orphaned GraphQL file. Every definition in it is unused and no document imports it, so it can likely be deleted.',
  },
  {
    delay: 4.75,
    className: 'warn',
    content:
      'These are candidates from a static scan. Verify each one before deleting.',
  },
  {
    delay: 5.04,
    content: (
      <>
        <span className="prompt">$ </span>
        <span className="dim">echo $?</span>
      </>
    ),
  },
  { delay: 5.34, className: 'hi', content: '1' },
  {
    delay: 5.6,
    content: (
      <>
        <span className="prompt">$ </span>
        <span className="caret" aria-hidden="true" />
      </>
    ),
  },
];

const SUMMARY = ['unused operation', 'unused fragment', 'orphaned file'];

/** Starts true the first time the element scrolls into view. */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

/** The animated scan recording with its summary status line. */
export function Scan() {
  // The recording waits until it is on screen, or it would finish before
  // anyone scrolls down to it.
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <section className="sec" id="scan" aria-labelledby="scan-h">
      <div className="wrap">
        <div className="split split-end" style={{ marginBottom: 40 }}>
          <div>
            <div className="eyebrow">gqlprune</div>
            <h2 className="h2" id="scan-h">
              One scan, three kinds of dead GraphQL
            </h2>
          </div>
          <p className="lead">
            A scan lists unused operations, unused fragments, and whole files
            where every definition is unused and no document imports them. Every
            finding carries a confidence grade.
          </p>
        </div>
        <div ref={ref} className={seen ? 'scan-demo playing' : 'scan-demo'}>
          <div className="term-wide">
            <Terminal
              cwd="~/app"
              exitCode={1}
              label="Terminal recording: gqlPrune scans the app fixture and reports one unused operation, one unused fragment and one orphaned file, all graded high."
              status={
                <>
                  {SUMMARY.map((label) => (
                    <span key={label}>
                      <b>1</b> {label} <span className="grade">high</span>
                    </span>
                  ))}
                  <span className="exit">exit 1</span>
                </>
              }
            >
              <div className="ln">
                <span className="prompt">$ </span>
                <span className="typed">
                  npx gqlprune --graphql graphql --src src
                </span>
                <span className="caret caret-cmd" aria-hidden="true" />
              </div>
              {LINES.map((line, index) => (
                <div
                  key={index}
                  className={['ln', 'tl', line.className]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ animationDelay: `${line.delay}s` }}
                >
                  {line.content}
                </div>
              ))}
            </Terminal>
          </div>
        </div>
        <p className="caption">
          Real output, recorded from the <code>app</code> project in gqlPrune's
          end-to-end test fixtures.
        </p>
      </div>
    </section>
  );
}
