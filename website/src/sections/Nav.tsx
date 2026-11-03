// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { Lockup } from '../components/Logo';
import { LINKS } from '../links';

/** The sticky top bar: logo and project links. */
export function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav-in">
        <a className="lockup" href="#top" aria-label="gqlPrune home">
          <Lockup />
        </a>
        <nav className="nav-links" aria-label="Main">
          <a href={LINKS.docs}>Docs</a>
          <a href={LINKS.github}>GitHub</a>
          <a href={LINKS.npm}>npm</a>
          <a href={LINKS.changelog}>Changelog</a>
        </nav>
      </div>
    </header>
  );
}
