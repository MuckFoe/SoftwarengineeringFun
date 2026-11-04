import { putPreferences } from "../api/client";
import type { Me, Preferences } from "../api/types";
import {
  CHAT_VISIBILITY_KEY,
  loadChatVisibility,
  saveChatVisibility,
} from "../components/chatVisibility";
import { type Choice, loadChoice, resolve, saveChoice } from "../theme/appearance";

/**
 * The one preference store (spec 012 FR-15..FR-18): appearance and chat visibility, kept
 * in memory over `localStorage`. Every hook reading a preference subscribes here, so a
 * change anywhere (toolbar, profile, another account sync) applies at once everywhere.
 * `localStorage` stays the browser's copy, so the pre-paint script and the signed-out
 * state keep whatever was last applied (FR-17).
 */
export interface PrefValues {
  appearance: Choice;
  chatVisible: boolean;
}

export type PrefKey = keyof PrefValues;

const QUERY = "(prefers-color-scheme: dark)";

/** Whether the OS is dark now; without matchMedia, whatever the pre-paint script decided. */
export function osIsDark(): boolean {
  if (typeof window.matchMedia === "function") return window.matchMedia(QUERY).matches;
  return document.documentElement.getAttribute("data-appearance") === "dark";
}

const memory: PrefValues = { appearance: "system", chatVisible: true };
const listeners = new Set<() => void>();
let signedIn = false;

function storageReadable(): boolean {
  try {
    localStorage.getItem(CHAT_VISIBILITY_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Current values: `localStorage` when it can be read (it may have changed under us), else memory. */
function read(): PrefValues {
  if (storageReadable()) {
    memory.appearance = loadChoice();
    memory.chatVisible = loadChatVisibility() === "shown";
  }
  return memory;
}

export const getAppearance = (): Choice => read().appearance;
export const getChatVisible = (): boolean => read().chatVisible;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write<K extends PrefKey>(key: K, value: PrefValues[K]): void {
  memory[key] = value;
  if (key === "appearance") {
    saveChoice(value as Choice);
    // Applied at once, before React re-renders (FR-18 "at once").
    document.documentElement.setAttribute("data-appearance", resolve(value as Choice, osIsDark()));
  } else {
    saveChatVisibility(value ? "shown" : "hidden");
  }
}

function notify(): void {
  for (const l of listeners) l();
}

function send(p: Partial<Preferences>): void {
  // A failed save keeps the change in this browser; the next change or sign-in retries.
  try {
    putPreferences(p).catch(() => undefined);
  } catch {
    // Never let a save break the caller (a click handler, or `useMe` resolving).
  }
}

/** Set one preference: always this browser, plus the account when signed in (FR-15, FR-17). */
export function savePreference<K extends PrefKey>(key: K, value: PrefValues[K]): void {
  write(key, value);
  notify();
  if (!signedIn) return;
  send(key === "appearance" ? { appearance: value as Choice } : { chat_visible: value as boolean });
}

/**
 * Reconcile with the account once `/api/me` resolves: no stored preferences yet → keep
 * this browser's as the account's (FR-16); stored preferences → apply them here (FR-15).
 * Signed out changes nothing, so the browser stays on what it had last (FR-17).
 */
export function syncOnLoad(me: Me): void {
  signedIn = me.signed_in;
  if (!me.signed_in) return;
  if (me.preferences === null) {
    const now = read();
    send({ appearance: now.appearance, chat_visible: now.chatVisible });
    return;
  }
  // A `Me` without the field (older server, test doubles) changes nothing.
  if (!me.preferences) return;
  write("appearance", me.preferences.appearance);
  write("chatVisible", me.preferences.chat_visible);
  notify();
}
