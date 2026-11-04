// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import type { ReactNode, SVGProps } from 'react';

type IconProps = { size?: number; strokeWidth?: number } & Omit<
  SVGProps<SVGSVGElement>,
  'width' | 'height'
>;

function Icon({
  size = 16,
  strokeWidth = 2,
  children,
  ...rest
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ArrowUpRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 17 17 7" />
    <path d="M8 7h9v9" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Icon>
);

export const FileIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
  </Icon>
);

export const Warning = (p: IconProps) => (
  <Icon strokeWidth={2.2} {...p}>
    <path d="M12 3 2 20h20L12 3z" />
    <path d="M12 10v4" />
    <path d="M12 17.5v.01" />
  </Icon>
);

export const XCircle = (p: IconProps) => (
  <Icon size={22} {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9 9l6 6" />
    <path d="M15 9l-6 6" />
  </Icon>
);

export const Cross = (p: IconProps) => (
  <Icon strokeWidth={2.6} {...p}>
    <path d="M6 6l12 12" />
    <path d="M18 6 6 18" />
  </Icon>
);

export const Lock = (p: IconProps) => (
  <Icon size={22} {...p}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Icon>
);

export const Plus = (p: IconProps) => (
  <Icon size={14} strokeWidth={2.4} {...p}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Icon>
);
