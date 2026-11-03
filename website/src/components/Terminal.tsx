// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import type { ReactNode } from 'react';

type TerminalProps = {
  /** The working directory shown in the title bar. */
  cwd: string;
  exitCode: number;
  /** Names the terminal for screen readers, which also read its lines. */
  label: string;
  className?: string;
  /** An optional status line along the bottom edge. */
  status?: ReactNode;
  children: ReactNode;
};

/** A terminal window frame. Its lines are passed as children. */
export function Terminal({
  cwd,
  exitCode,
  label,
  className,
  status,
  children,
}: TerminalProps) {
  return (
    <div
      className={['term', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={label}
    >
      <div className="term-bar">
        <span className="dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="grow">{cwd}</span>
        <span>exit {exitCode}</span>
      </div>
      <div className="term-body">{children}</div>
      {status && <div className="term-status">{status}</div>}
    </div>
  );
}
