/**
 * Semantic icon names the app uses -> Audi icon-library name (names only; the Audi artwork
 * is supplied at deploy through brand-assets/icons/<audi>.svg, never committed) and the
 * Lucide icon used for the committed fallback (frontend/scripts/gen-fallback-icons.mjs).
 */
export const iconMap = {
  sidebar: { audi: "off-canvas", lucide: "panel-left" },
  inspector: { audi: "options", lucide: "panel-right" },
  bottomPanel: { audi: "split", lucide: "panel-bottom" },
  play: { audi: "play", lucide: "play" },
  stop: { audi: "stop", lucide: "square" },
  person: { audi: "user", lucide: "user" },
  personCheck: { audi: "main-user", lucide: "user-check" },
  people: { audi: "groups", lucide: "users" },
  link: { audi: "weblink", lucide: "link" },
  sun: { audi: "lights-day", lucide: "sun" },
  moon: { audi: "lights-dim", lucide: "moon" },
  circleHalf: { audi: "display", lucide: "contrast" },
  chevronLeft: { audi: "arrow-left-light", lucide: "chevron-left" },
  chevronRight: { audi: "arrow-right-light", lucide: "chevron-right" },
  chevronUp: { audi: "arrow-up", lucide: "chevron-up" },
  chevronDown: { audi: "arrow-down", lucide: "chevron-down" },
  search: { audi: "search", lucide: "search" },
  plus: { audi: "add", lucide: "plus" },
  checkmark: { audi: "select", lucide: "check" },
  xmark: { audi: "cancel", lucide: "x" },
  gear: { audi: "settings", lucide: "settings" },
  exclamation: { audi: "caution", lucide: "triangle-alert" },
  chat: { audi: "discussion", lucide: "message-square" },
  doc: { audi: "documents", lucide: "file-text" },
  trash: { audi: "erase", lucide: "trash-2" },
  pencil: { audi: "edit", lucide: "pencil" },
} as const satisfies Record<string, { audi: string; lucide: string }>;

export type BrandIconName = keyof typeof iconMap;
