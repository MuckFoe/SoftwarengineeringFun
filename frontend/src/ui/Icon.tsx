import type { ReactNode } from "react";

/**
 * Hand-drawn inline icons on a 16 px grid (FR-1, NFR-1). Strokes and fills use
 * `currentColor` so icons take the colour of the control they sit in. No icon package,
 * no external references.
 */
const PATHS = {
  sidebar: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <line x1="6" y1="2.75" x2="6" y2="13.25" />
    </>
  ),
  /** The sidebar mirrored: a window with its right-hand inspector. */
  inspector: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <line x1="10" y1="2.75" x2="10" y2="13.25" />
    </>
  ),
  /** A window with a panel along its bottom edge. */
  bottomPanel: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <line x1="1.75" y1="9.5" x2="14.25" y2="9.5" />
    </>
  ),
  play: (
    <path
      d="M5 3.2v9.6a.5.5 0 0 0 .76.43l7.6-4.8a.5.5 0 0 0 0-.86l-7.6-4.8A.5.5 0 0 0 5 3.2Z"
      fill="currentColor"
    />
  ),
  stop: <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" />,
  person: (
    <>
      <circle cx="8" cy="5.25" r="2.75" />
      <path d="M2.75 14c.4-2.9 2.6-4.5 5.25-4.5s4.85 1.6 5.25 4.5" />
    </>
  ),
  people: (
    <>
      <circle cx="6" cy="5.5" r="2.25" />
      <path d="M1.75 13.5c.3-2.4 2-3.75 4.25-3.75s3.95 1.35 4.25 3.75" />
      <path d="M10.5 3.6a2.25 2.25 0 0 1 0 3.8M12 9.9c1.3.5 2.1 1.7 2.25 3.6" />
    </>
  ),
  link: (
    <>
      <path d="M7 9a3 3 0 0 0 4.24 0l2-2a3 3 0 0 0-4.24-4.24l-.75.75" />
      <path d="M9 7a3 3 0 0 0-4.24 0l-2 2A3 3 0 0 0 7 13.24l.75-.75" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" />
    </>
  ),
  moon: <path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z" />,
  circleHalf: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 2a6 6 0 0 1 0 12Z" fill="currentColor" />
    </>
  ),
  chevronLeft: <path d="M10 3.5 5.5 8l4.5 4.5" />,
  chevronRight: <path d="M6 3.5 10.5 8 6 12.5" />,
  chevronUp: <path d="M3.5 10 8 5.5l4.5 4.5" />,
  chevronDown: <path d="M3.5 6 8 10.5 12.5 6" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <line x1="10.1" y1="10.1" x2="13.75" y2="13.75" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  checkmark: <path d="m3.5 8.5 3 3 6-7" />,
  xmark: <path d="m4 4 8 8M12 4l-8 8" />,
  gear: (
    <>
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 1.75v1.7M8 12.55v1.7M14.25 8h-1.7M3.45 8h-1.7M12.42 3.58l-1.2 1.2M4.78 11.22l-1.2 1.2M12.42 12.42l-1.2-1.2M4.78 4.78l-1.2-1.2" />
      <circle cx="8" cy="8" r="4.5" />
    </>
  ),
  exclamation: (
    <>
      <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.6 9.75a1 1 0 0 1-.87 1.5H2.4a1 1 0 0 1-.87-1.5Z" />
      <path d="M8 6v3.25" />
      <circle cx="8" cy="11.25" r="0.6" fill="currentColor" />
    </>
  ),
  chat: (
    <path d="M2.25 4.5a2 2 0 0 1 2-2h7.5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7l-3 2.5v-2.5h0a1.75 1.75 0 0 1-1.75-1.75Z" />
  ),
  doc: (
    <>
      <path d="M4 1.75h5.25L12.25 4.75v9.5H4Z" />
      <path d="M9 1.75v3.25h3.25M6 8h4M6 10.5h4" />
    </>
  ),
  trash: (
    <>
      <path d="M2.5 4h11M6.25 4V2.5h3.5V4M4 4l.7 9.5h6.6L12 4" />
      <path d="M6.75 6.5v4.5M9.25 6.5v4.5" />
    </>
  ),
  pencil: <path d="M10.5 2.5 13.5 5.5 5.5 13.5H2.5V10.5Z M9 4l3 3" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

interface Props {
  name: IconName;
  /** Accessible name. Without it the icon is decorative and hidden from assistive tech. */
  label?: string;
  size?: number;
}

export function Icon({ name, label, size = 16 }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      role="img"
      aria-hidden={label ? undefined : true}
    >
      <title>{label ?? ""}</title>
      {PATHS[name]}
    </svg>
  );
}
