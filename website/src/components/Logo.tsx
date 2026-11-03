// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

/**
 * The "cut branch" mark: two connected nodes on a stem and a third node whose
 * branch is cut. The tile colours are fixed so it reads on both themes.
 */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#F2B544" />
      <path
        d="M11 8V24"
        stroke="#1A1406"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="11" cy="8" r="3.6" fill="#1A1406" />
      <circle cx="11" cy="24" r="3.6" fill="#1A1406" />
      <path
        d="M11 16H15.6"
        stroke="#1A1406"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <circle
        cx="23.6"
        cy="17.6"
        r="3.3"
        fill="none"
        stroke="#1A1406"
        strokeWidth="2.6"
      />
    </svg>
  );
}

/** The mark next to the gqlPrune wordmark. */
export function Lockup({
  size = 30,
  fontSize = 22,
}: {
  size?: number;
  fontSize?: number;
}) {
  return (
    <>
      <LogoMark size={size} />
      <span className="wm" style={{ fontSize }}>
        <span className="wm-a">gql</span>
        <span className="wm-b">Prune</span>
      </span>
    </>
  );
}
