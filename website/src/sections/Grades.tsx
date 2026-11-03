// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { Terminal } from '../components/Terminal';

const GRADES = [
  {
    chip: 'high',
    reason: 'name-absent',
    title: 'The name appears nowhere',
    body: 'Not as an identifier and not inside a string, anywhere in the scanned source. The strongest candidates, and a safe level to gate CI on.',
  },
  {
    chip: 'medium',
    reason: 'generated-only',
    title: 'Only generated files mention it',
    body: 'The mention is probably codegen output rather than code someone wrote to call the operation.',
  },
  {
    chip: 'low',
    reason: 'name-referenced, string-mention',
    title: 'The bare name is still read',
    body: 'An identifier or a string holds the exact name. A naming convention gqlPrune does not know, or a lookup at runtime, is plausible.',
    code: 'usagePatterns',
  },
];

/** The three confidence grades and a scan that shows two of them. */
export function Grades() {
  return (
    <section className="sec" id="grades" aria-labelledby="grades-h">
      <div className="wrap">
        <div className="split split-end">
          <div>
            <div className="eyebrow">gqlprune --min-confidence high</div>
            <h2 className="h2" id="grades-h">
              Candidates, graded by the evidence against them
            </h2>
          </div>
          <p className="lead">
            A static read cannot prove that an operation is dead. A name built
            at runtime, a caller in another repository or a file type the parser
            skips can all hide a real use. So each finding gets a grade for how
            much evidence suggests something still references it.
          </p>
        </div>
        <div className="grades">
          {GRADES.map((grade) => (
            <div className="card grade" key={grade.chip}>
              <div className="grade-top">
                <span className={`chip chip-${grade.chip}`}>{grade.chip}</span>
                <span className="reason">{grade.reason}</span>
              </div>
              <h3>{grade.title}</h3>
              <p>
                {grade.body}
                {grade.code && (
                  <>
                    {' '}
                    Check <code>{grade.code}</code>.
                  </>
                )}
              </p>
            </div>
          ))}
        </div>
        <Terminal
          className="term-gap"
          cwd="~/combined"
          exitCode={1}
          label="Terminal output from the combined fixture with two high and one low finding"
        >
          <div className="ln">
            <span className="prompt">$ </span>npx gqlprune
          </div>
          <div className="ln dim">
            Using settings derived from codegen.ts: graphqlDir, srcDir, exclude,
            schemaFile, inline.
          </div>
          <div className="ln dim">...</div>
          <div className="ln hd">--- Unused GraphQL Operations ---</div>
          <div className="ln"> </div>
          <div className="ln dim">
            {'Type  Operation               Confidence File'}
          </div>
          <div className="ln">
            {'query GetCombinedGhost        '}
            <span className="hi">high</span>
            {'       ghost.gql'}
          </div>
          <div className="ln">
            {'query GetCombinedLegacyExport '}
            <span className="lo">low</span>
            {'        legacy.gql'}
          </div>
          <div className="ln">
            {'query GetCombinedInlineGhost  '}
            <span className="hi">high</span>
            {'       Dashboard.tsx'}
          </div>
          <div className="ln dim">---------------------------------</div>
          <div className="ln">
            Found 3 unused GraphQL operations. Please remove them.
          </div>
        </Terminal>
        <p className="caption">
          Real output from the <code>combined</code> fixture, which takes its
          directories from a <code>codegen.ts</code>. Lines between the settings
          line and the table are omitted.
        </p>
      </div>
    </section>
  );
}
