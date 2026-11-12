import { useSyncExternalStore } from "react";
import { getChatVisible, savePreference, subscribe } from "../prefs/accountPrefs";

/**
 * Whether the chat beside the description is shown, remembered per browser (FR-4).
 * `localStorage` failures (private mode, blocked storage) fall back to "shown" and
 * never throw, like `theme/appearance.ts`.
 */
export type ChatVisibility = "shown" | "hidden";

export const CHAT_VISIBILITY_KEY = "chatVisible";

export function loadChatVisibility(): ChatVisibility {
  try {
    return localStorage.getItem(CHAT_VISIBILITY_KEY) === "hidden" ? "hidden" : "shown";
  } catch {
    return "shown";
  }
}

export function saveChatVisibility(v: ChatVisibility): void {
  try {
    localStorage.setItem(CHAT_VISIBILITY_KEY, v);
  } catch {
    // Storage unavailable: the choice still applies for this page, it just isn't kept.
  }
}

/**
 * The remembered chat visibility; every set goes through the one preference store, so
 * every caller (and the profile) agrees at once (spec 012 FR-18).
 */
export function useChatVisible(): [visible: boolean, setVisible: (v: boolean) => void] {
  const visible = useSyncExternalStore(subscribe, getChatVisible);
  return [visible, setChatVisible];
}

function setChatVisible(v: boolean): void {
  savePreference("chatVisible", v);
}

/** Whether this browser holds a chat choice at all (unreadable storage: no). */
export function hasStoredChatVisibility(): boolean {
  try {
    return localStorage.getItem(CHAT_VISIBILITY_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * The chat as a pinnable panel: pinned is the remembered "shown" (the same preference, so the
 * profile and the account keep it). Where nothing was chosen yet, `defaultPinned` applies,
 * such as unpinned on a phone.
 */
export function useChatPinned(
  defaultPinned: boolean,
): [pinned: boolean, setPinned: (pinned: boolean) => void] {
  const [visible, setVisible] = useChatVisible();
  return [hasStoredChatVisibility() ? visible : defaultPinned, setVisible];
}
