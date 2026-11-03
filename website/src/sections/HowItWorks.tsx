// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import type { ReactNode } from 'react';
import { Cross } from '../components/Icons';

const STEPS: { title: string; body: ReactNode; io: string }[] = [
  {
    title: 'Read the documents',
    body: (
      <>
        Parses every <code>.gql</code> and <code>.graphql</code> file and lists
        each operation and fragment with its file and line.
      </>
    ),
    io: 'graphql/**/*.gql',
  },
  {
    title: 'Parse the source',
    body: 'Parses each TypeScript and JavaScript file once into a module model: imports, exports and every identifier in a reference position.',
    io: '.ts .tsx .js .jsx .mjs .cjs .mts .cts',
  },
  {
    title: 'Resolve references',
    body: "Follows named, default and namespace imports, re-exports and barrel files with the compiler's own module resolution and your tsconfig paths.",
    io: './api/index.ts > ./hooks.ts',
  },
  {
    title: 'Report candidates',
    body: 'Matches references against your usage patterns, then grades and prints whatever nothing reaches.',
    io: 'use{Name}{Type}, {Name}Document',
  },
];

const NEVER = [
  'Starts your server',
  'Runs introspection',
  'Executes your code or your codegen config',
  'Makes network requests',
];

const DEFAULT_CHECKS: { title: string; body: ReactNode }[] = [
  {
    title: 'Unused operations',
    body: 'Queries, mutations and subscriptions that no reference in your source resolves to.',
  },
  {
    title: 'Unused fragments',
    body: 'Fragments that no operation spreads, directly or through other fragments, and that no source file references.',
  },
  {
    title: 'Orphaned files',
    body: (
      <>
        Documents where every definition is unused and no other document pulls
        the file in with <code>#import</code>.
      </>
    ),
  },
];

const OPT_IN_CHECKS: { flag: string; title: string; body: ReactNode }[] = [
  {
    flag: '--inline',
    title: 'Inline documents',
    body: (
      <>
        Also reads <code>gql</code> tagged templates and <code>graphql()</code>{' '}
        calls in your source files.
      </>
    ),
  },
  {
    flag: '--fields',
    title: 'Field candidates',
    body: "Traces each used operation's result through your code and lists selected fields that nothing reads.",
  },
  {
    flag: '--schema <file>',
    title: 'Deprecated selections',
    body: 'Validates documents against a local SDL file and lists selections of fields and enum values marked deprecated.',
  },
];

/** The four scan steps, what a scan never does, and the checks. */
export function HowItWorks() {
  return (
    <section className="sec" id="how" aria-labelledby="how-h">
      <div className="wrap">
        <div className="split split-end">
          <div>
            <div className="eyebrow">$ gqlprune --verbose</div>
            <h2 className="h2" id="how-h">
              How a scan works
            </h2>
          </div>
          <p className="lead">
            gqlPrune parses your code with the TypeScript compiler and resolves
            every reference to the name it reaches. Nothing runs and no type
            checker starts, so a scan needs nothing but the files on disk.
          </p>
        </div>
        <ol className="steps">
          {STEPS.map((step, index) => (
            <li className="step" key={step.title}>
              <span className="num">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <span className="io">{step.io}</span>
            </li>
          ))}
        </ol>
        <ul className="never" aria-label="A scan never">
          {NEVER.map((item) => (
            <li key={item}>
              <Cross /> {item}
            </li>
          ))}
        </ul>

        <p className="group-label">checked on every scan</p>
        <div className="checks">
          {DEFAULT_CHECKS.map((check) => (
            <div className="card" key={check.title}>
              <span className="chip chip-flag tag">default</span>
              <h3>{check.title}</h3>
              <p>{check.body}</p>
            </div>
          ))}
        </div>
        <p className="group-label">opt-in checks</p>
        <div className="checks">
          {OPT_IN_CHECKS.map((check) => (
            <div className="card" key={check.title}>
              <span className="chip chip-flag tag">{check.flag}</span>
              <h3>{check.title}</h3>
              <p>{check.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
