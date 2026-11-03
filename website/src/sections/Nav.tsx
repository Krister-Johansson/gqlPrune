// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { Lockup } from '../components/Logo';
import { Moon, Sun } from '../components/Icons';
import { LINKS } from '../links';
import type { Theme } from '../theme';

type NavProps = { theme: Theme; onToggleTheme: () => void };

/** The sticky top bar: logo, project links and the theme toggle. */
export function Nav({ theme, onToggleTheme }: NavProps) {
  const isDark = theme === 'dark';
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
        <div className="nav-tools">
          <button
            className="theme-btn"
            type="button"
            onClick={onToggleTheme}
            aria-label={
              isDark ? 'Switch to the light theme' : 'Switch to the dark theme'
            }
          >
            {isDark ? <Sun /> : <Moon />}
          </button>
        </div>
      </div>
    </header>
  );
}
