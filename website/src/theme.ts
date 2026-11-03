// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

// Must match the key the inline script in index.html reads before the first
// paint.
const STORAGE_KEY = 'gqlprune-theme';
const LIGHT_QUERY = '(prefers-color-scheme: light)';

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark';
}

/**
 * The page theme: the visitor's own choice when they made one, otherwise the
 * system setting, which is followed live until they pick.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(
    () => storedTheme() ?? systemTheme(),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const query = window.matchMedia(LIGHT_QUERY);
    const follow = () => {
      if (storedTheme() === null) setTheme(systemTheme());
    };
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Private browsing can refuse storage; the toggle still works for
        // this visit.
      }
      return next;
    });
  }, []);

  return [theme, toggle];
}
