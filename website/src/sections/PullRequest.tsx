// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { FileIcon, Warning } from '../components/Icons';

const BODY_LINES: [number, string][] = [
  [4, '  legacyReport {'],
  [5, '    id'],
  [6, '    title'],
  [7, '  }'],
  [8, '}'],
];

/** A pull request diff with the `--annotate` warning on the unused query. */
export function PullRequest() {
  return (
    <section className="sec" id="pr" aria-labelledby="pr-h">
      <div className="wrap split">
        <div className="stack">
          <div className="eyebrow">$ gqlprune --annotate</div>
          <h2 className="h2" id="pr-h">
            Findings show up on the pull request
          </h2>
          <p className="lead">
            Under GitHub Actions, every finding becomes a <code>::warning</code>{' '}
            annotation on the file and line that defines it, with its grade at
            the end. Reviewers see it in Files changed without opening the job
            log.
          </p>
          <p className="lead">
            Annotations turn on by themselves when <code>GITHUB_ACTIONS</code>{' '}
            is set. They go to stderr, so <code>--json</code> output stays
            clean.
          </p>
        </div>
        <div>
          <div className="pr">
            <div className="pr-hd">
              <FileIcon />
              <span>graphql/legacyReport.gql</span>
              <span className="add">+8</span>
            </div>
            <div className="diff">
              <div className="exp">Lines 1 to 2 hidden</div>
              <div className="row add-row">
                <span className="n">3</span>
                <span className="c">
                  <span className="kw">query</span> GetLegacyReport {'{'}
                </span>
              </div>
              <div className="anno-slot">
                <div className="anno">
                  <div className="anno-hd">
                    <span className="w">
                      <Warning />
                    </span>
                    <span>Check warning on line 3</span>
                    <span className="job">gqlprune</span>
                  </div>
                  <div className="anno-bd">
                    Unused GraphQL operation "GetLegacyReport" (query)
                    [confidence: high]
                  </div>
                </div>
              </div>
              {BODY_LINES.map(([number, text]) => (
                <div className="row add-row" key={number}>
                  <span className="n">{number}</span>
                  <span className="c">{text}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="why">
            <div className="why-out">
              <div className="ln dim">$ npx gqlprune --verbose</div>
              <div className="ln">
                <span className="dim">[verbose]</span> unused: GetLegacyReport
                (query): no reference to useGetLegacyReportQuery,
                useGetLegacyReportLazyQuery, useGetLegacyReportSuspenseQuery,
                GetLegacyReportDocument
              </div>
              <div className="ln">
                <span className="dim">[verbose]</span> confidence: operation
                "GetLegacyReport" is high (name-absent: the name appears in no
                scanned source file)
              </div>
            </div>
            <div className="hint">
              <b>Next step</b>
              <span>
                If nothing calls it, delete the operation. If your client calls
                it under another name, add that name to{' '}
                <code>usagePatterns</code> and run the scan again.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
