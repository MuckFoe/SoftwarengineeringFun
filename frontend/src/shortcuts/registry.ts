/**
 * The single table of every keyboard shortcut (FR-17). Nothing else defines a combo:
 * the dispatcher, the shortcut list and the reserved-combo check all read this.
 */

/** `key` is a `KeyboardEvent.key` value (letters lower case). `mod` is ⌘ on macOS, Ctrl elsewhere. */
export interface Combo {
  key: string;
  mod?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export type Scope = "global" | "session" | "problems" | "sheet";

export type ShortcutId =
  | "run"
  | "close"
  | "defaultButton"
  | "focusSearch"
  | "newProblem"
  | "saveProblem"
  | "toggleSidebar"
  | "toggleRunPanel"
  | "toggleChat"
  | "nextProblem"
  | "previousProblem"
  | "copyInviteLink"
  | "appearance"
  | "shortcutList";

export interface Shortcut {
  id: ShortcutId;
  label: string;
  mac: Combo;
  other: Combo;
  scope: Scope;
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: "run",
    label: "Run code",
    mac: { key: "Enter", mod: true },
    other: { key: "Enter", mod: true },
    scope: "session",
  },
  {
    id: "close",
    label: "Close sheet or popover",
    mac: { key: "Escape" },
    other: { key: "Escape" },
    scope: "sheet",
  },
  {
    id: "defaultButton",
    label: "Default button",
    mac: { key: "Enter" },
    other: { key: "Enter" },
    scope: "sheet",
  },
  {
    id: "focusSearch",
    label: "Focus search",
    mac: { key: "f", mod: true },
    other: { key: "f", mod: true },
    scope: "problems",
  },
  {
    id: "newProblem",
    label: "New problem",
    mac: { key: "n", mod: true, alt: true },
    other: { key: "n", mod: true, alt: true },
    scope: "problems",
  },
  {
    id: "saveProblem",
    label: "Save problem",
    mac: { key: "s", mod: true },
    other: { key: "s", mod: true },
    scope: "sheet",
  },
  {
    id: "toggleSidebar",
    label: "Show or hide sidebar",
    mac: { key: "s", mod: true, ctrl: true },
    other: { key: "s", mod: true, alt: true },
    scope: "global",
  },
  {
    id: "toggleRunPanel",
    label: "Show or hide run panel",
    mac: { key: "r", mod: true, ctrl: true },
    other: { key: "r", mod: true, alt: true },
    scope: "session",
  },
  {
    id: "toggleChat",
    label: "Show or hide chat",
    mac: { key: "c", mod: true, ctrl: true },
    other: { key: "c", mod: true, alt: true },
    scope: "session",
  },
  {
    id: "nextProblem",
    label: "Next problem",
    mac: { key: "ArrowDown", mod: true, ctrl: true },
    other: { key: "PageDown", mod: true, alt: true },
    scope: "session",
  },
  {
    id: "previousProblem",
    label: "Previous problem",
    mac: { key: "ArrowUp", mod: true, ctrl: true },
    other: { key: "PageUp", mod: true, alt: true },
    scope: "session",
  },
  {
    id: "copyInviteLink",
    label: "Copy invite link",
    mac: { key: "i", mod: true, ctrl: true },
    other: { key: "i", mod: true, alt: true },
    scope: "session",
  },
  {
    id: "appearance",
    label: "Appearance setting",
    mac: { key: ",", mod: true },
    other: { key: ",", mod: true },
    scope: "global",
  },
  {
    id: "shortcutList",
    label: "Shortcut list",
    mac: { key: "/", mod: true, shift: true },
    other: { key: "/", mod: true, shift: true },
    scope: "global",
  },
];
