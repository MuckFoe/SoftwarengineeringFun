import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a pinnable panel is pinned, remembered per browser under `pinned.<key>` in
 * `localStorage`, like `components/chatVisibility.ts`. Storage failures (private mode, blocked
 * storage) never throw: the choice is kept in memory for this page, and the default applies
 * where nothing was chosen. Every hook with the same key agrees at once, and another tab's
 * change applies through the `storage` event.
 */
export const PIN_STORAGE_PREFIX = "pinned.";

const memory = new Map<string, boolean>();
const listeners = new Set<() => void>();

export function loadPinned(key: string, defaultPinned: boolean): boolean {
  try {
    const stored = localStorage.getItem(PIN_STORAGE_PREFIX + key);
    if (stored === "true") return true;
    if (stored === "false") return false;
    return defaultPinned;
  } catch {
    // Storage unavailable: this page's memory, if anything was chosen.
    return memory.get(key) ?? defaultPinned;
  }
}

export function savePinned(key: string, pinned: boolean): void {
  memory.set(key, pinned);
  try {
    localStorage.setItem(PIN_STORAGE_PREFIX + key, String(pinned));
  } catch {
    // Storage unavailable: the choice still applies for this page, it just isn't kept.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** `[pinned, setPinned]` for one panel; `key` names it, e.g. "chat", "sidebar", "output". */
export function usePinned(
  key: string,
  defaultPinned: boolean,
): [pinned: boolean, setPinned: (pinned: boolean) => void] {
  const pinned = useSyncExternalStore(subscribe, () => loadPinned(key, defaultPinned));
  const setPinned = useCallback((next: boolean) => savePinned(key, next), [key]);
  return [pinned, setPinned];
}
