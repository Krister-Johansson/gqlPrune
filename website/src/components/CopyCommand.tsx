// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { useEffect, useState } from 'react';
import { CopyIcon } from './Icons';

/** A shell command in a dark box with a copy button. */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    // The clipboard API is missing on plain http other than localhost; the
    // command stays selectable by hand there.
    navigator.clipboard?.writeText(command).then(
      () => setCopied(true),
      () => {},
    );
  };

  return (
    <div className="cmd">
      <span className="p" aria-hidden="true">
        $
      </span>
      <span className="c">{command}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy the command ${command}`}
      >
        <CopyIcon />
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}
