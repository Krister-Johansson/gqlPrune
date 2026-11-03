// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import type { ReactNode } from 'react';
import { ArrowUpRight, Plus } from '../components/Icons';
import { LINKS } from '../links';

const QUESTIONS: { q: string; a: ReactNode }[] = [
  {
    q: 'Does gqlPrune need my GraphQL schema?',
    a: (
      <>
        <p>
          No. A scan reads your <code>.graphql</code> documents and your source
          code, nothing else. It never starts your server and never runs
          introspection.
        </p>
        <p>
          A schema is read only when you pass <code>--schema</code> or set{' '}
          <code>schemaFile</code>, and then only to report selections of fields
          and enum values marked <code>@deprecated</code>.
        </p>
      </>
    ),
  },
  {
    q: 'Can I delete everything it reports?',
    a: (
      <>
        <p>
          Check each finding first. They are candidates from a static scan. An
          operation can still be in use when its name is built at runtime, when
          the caller sits outside <code>srcDir</code> or in a file type gqlPrune
          does not parse, or when another repository imports it.
        </p>
        <p>
          The confidence grade says how much evidence points the other way, and{' '}
          <code>--verbose</code> shows exactly which identifiers were looked
          for.
        </p>
      </>
    ),
  },
  {
    q: 'Why does it say everything is used?',
    a: (
      <p>
        Usually because generated code sits inside <code>srcDir</code>. A file
        such as <code>src/gql/graphql.ts</code> references every document
        constant, so every operation looks used. gqlPrune warns when one file
        references most of your operations and names that file, so you can add
        it to <code>exclude</code>. <code>gqlprune init</code> pre-fills it for
        you.
      </p>
    ),
  },
  {
    q: 'Which GraphQL clients and code generators does it understand?',
    a: (
      <p>
        The default usage patterns match GraphQL Code Generator's React Apollo
        output, such as <code>useGetUserQuery</code> and{' '}
        <code>GetUserDocument</code>. When it finds a codegen config, gqlPrune
        derives the patterns for plugins such as <code>typescript-urql</code>,{' '}
        <code>typescript-react-query</code> and{' '}
        <code>typescript-apollo-angular</code>, and the client preset turns on
        inline scanning. For anything else, set <code>usagePatterns</code>.
      </p>
    ),
  },
  {
    q: 'How do I run it in CI without failing on every finding?',
    a: (
      <p>
        Pass <code>--min-confidence high</code>. The exit code follows what is
        reported, so the job fails only on findings whose name appears nowhere
        in the source. Developers can still run <code>npx gqlprune</code>{' '}
        locally and review the full list.
      </p>
    ),
  },
  {
    q: 'Does it work with Vue, Svelte or Astro files?',
    a: (
      <p>
        Partly. Name the extension in <code>sourceExtensions</code> and gqlPrune
        scans those files by their tokens, so a <code>useGetUserQuery()</code>{' '}
        call still counts. Imports inside them are not resolved.
      </p>
    ),
  },
  {
    q: 'Does it send anything over the network?',
    a: (
      <p>
        No. gqlPrune makes no network requests. It reads files from disk and
        prints a report.
      </p>
    ),
  },
  {
    q: 'Can I get the results as JSON?',
    a: (
      <p>
        Yes. <code>--json</code> prints one JSON document on stdout with every
        finding, its grade and a summary. Diagnostics and annotations go to
        stderr, so you can pipe the output straight into <code>jq</code>.
      </p>
    ),
  },
];

/** Common questions as native disclosure widgets. */
export function Faq() {
  return (
    <section className="sec" id="faq" aria-labelledby="faq-h">
      <div className="wrap faq-grid">
        <div>
          <div className="eyebrow">gqlprune --help</div>
          <h2 className="h2" id="faq-h">
            Questions
          </h2>
          <p className="lead faq-lead">The full reference lives in the docs.</p>
          <div className="faq-cta">
            <a className="btn btn-secondary" href={LINKS.docs}>
              Read the docs <ArrowUpRight />
            </a>
          </div>
        </div>
        <div className="faq">
          {QUESTIONS.map((item, index) => (
            <details key={item.q} open={index === 0}>
              <summary>
                {item.q}
                <span className="pm">
                  <Plus />
                </span>
              </summary>
              <div className="faq-a">{item.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
