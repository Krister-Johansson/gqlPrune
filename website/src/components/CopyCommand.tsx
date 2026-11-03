// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { useEffect, useRef, useState } from 'react';
import { CopyIcon } from './Icons';

type CopyState = 'idle' | 'copied' | 'failed';

// Every label fits the 6ch the button reserves, so the box never resizes.
const LABELS: Record<CopyState, string> = {
  idle: 'Copy',
  copied: 'Copied',
  failed: 'Failed',
};

/** A shell command in a dark box with a copy button. */
export function CopyCommand({ command }: { command: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const commandRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 1600);
    return () => clearTimeout(timer);
  }, [state]);

  const fail = () => {
    // Select the command so the visitor can copy it with the keyboard.
    const node = commandRef.current;
    if (node) window.getSelection()?.selectAllChildren(node);
    setState('failed');
  };

  const copy = () => {
    // The clipboard API is missing outside secure contexts, and a visitor can
    // deny the permission; both end in fail().
    if (!navigator.clipboard) {
      fail();
      return;
    }
    navigator.clipboard.writeText(command).then(() => setState('copied'), fail);
  };

  return (
    <div className="cmd">
      <span className="p" aria-hidden="true">
        $
      </span>
      <span className="c" ref={commandRef}>
        {command}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy the command ${command}`}
      >
        <CopyIcon />
        <span className="cmd-label" aria-live="polite">
          {LABELS[state]}
        </span>
      </button>
      {state === 'failed' && (
        <span className="visually-hidden" role="status">
          Copying failed. The command is selected; press Ctrl+C or Cmd+C to copy
          it.
        </span>
      )}
    </div>
  );
}
