// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { Lockup } from '../components/Logo';
import { COMMAND, LINKS } from '../links';

/** Project and trust links, and the license line. */
export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div>
            <span className="lockup">
              <Lockup size={28} fontSize={21} />
            </span>
            <p className="blurb">
              A schema-free CLI that finds unused GraphQL operations and
              fragments. Published to npm with Sigstore provenance. Each GitHub
              release carries a signed CycloneDX SBOM.
            </p>
          </div>
          <div>
            <h3>project</h3>
            <ul>
              <li>
                <a href={LINKS.docs}>Docs</a>
              </li>
              <li>
                <a href={LINKS.github}>GitHub</a>
              </li>
              <li>
                <a href={LINKS.npm}>npm</a>
              </li>
              <li>
                <a href={LINKS.changelog}>Changelog</a>
              </li>
            </ul>
          </div>
          <div>
            <h3>trust</h3>
            <ul>
              <li>
                <a href={LINKS.security}>Security policy</a>
              </li>
              <li>
                <a href={LINKS.verify}>Verify a release</a>
              </li>
              <li>
                <a href={LINKS.license}>MIT license</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="legal">
          <span>MIT licensed. Copyright (c) 2023 Krister Johansson.</span>
          <span className="mono">{COMMAND}</span>
        </div>
      </div>
    </footer>
  );
}
