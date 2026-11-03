// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { Cross, Lock, XCircle } from '../components/Icons';

const EXIT_CODES: [number, string][] = [
  [0, 'The scan finished and found nothing unused.'],
  [1, 'The scan finished and found unused operations or fragments.'],
  [
    2,
    'The run failed: a bad flag, no configuration, or a directory that does not exist.',
  ],
];

// The workflow from the README, as [indent, key, value] rows.
const WORKFLOW: [string, string, string][] = [
  ['', 'name', ' gqlprune'],
  ['', 'on', ' [pull_request]'],
  ['', 'jobs', ''],
  ['  ', 'gqlprune', ''],
  ['    ', 'runs-on', ' ubuntu-latest'],
  ['    ', 'steps', ''],
  ['      - ', 'uses', ' actions/checkout@v4'],
  ['      - ', 'uses', ' actions/setup-node@v4'],
  ['        ', 'with', ''],
  ['          ', 'node-version', ' 20'],
  ['      - ', 'run', ' npm ci'],
  ['      - ', 'run', ' npx gqlprune --min-confidence high'],
];

/** Exit codes, a blocked merge box and the CI workflow. */
export function RequiredCheck() {
  return (
    <section className="sec" id="ci" aria-labelledby="ci-h">
      <div className="wrap split">
        <div className="stack">
          <div className="eyebrow">echo $?</div>
          <h2 className="h2" id="ci-h">
            Run it as a required check
          </h2>
          <p className="lead">
            gqlPrune exits with 1 when it finds unused operations or fragments,
            and with 2 when the run itself fails. Mark the job as required in
            branch protection, and a pull request that leaves dead GraphQL
            behind cannot merge.
          </p>
          <dl className="exits">
            {EXIT_CODES.map(([code, meaning]) => (
              <div className="exit-row" key={code}>
                <dt>{code}</dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>
          <p className="note">
            Start with <code>--min-confidence high</code> to fail only on
            findings whose name appears nowhere in your source.
          </p>
        </div>
        <div className="stack">
          <div className="merge">
            <div className="merge-row">
              <span className="ico">
                <XCircle />
              </span>
              <div>
                <h3>Some checks were not successful</h3>
                <p>1 failing check</p>
              </div>
            </div>
            <div className="check">
              <span className="x">
                <Cross />
              </span>
              <span className="name">gqlprune / gqlprune (pull_request)</span>
              <span className="st">Failing</span>
              <span className="req">Required</span>
              <a href="#pr">Details</a>
            </div>
            <div className="merge-row blocked">
              <span className="ico mute">
                <Lock />
              </span>
              <div>
                <h3>Merging is blocked</h3>
                <p>
                  A required check has not passed. Fix the findings or adjust
                  the gate, then push again.
                </p>
              </div>
            </div>
          </div>
          <div className="codeblk">
            <div className="codeblk-hd">
              <span>.github/workflows/gqlprune.yml</span>
              <span>from the README</span>
            </div>
            <div className="pre">
              {WORKFLOW.map(([indent, key, value], index) => (
                <div className="ln" key={index}>
                  {indent}
                  <span className="k">{key}</span>:
                  <span className="v">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
