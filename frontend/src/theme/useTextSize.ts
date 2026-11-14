import { useSyncExternalStore } from "react";
import { getTextSize, savePreference, subscribe } from "../prefs/accountPrefs";
import type { TextSize } from "./textSize";

/** The user's text size, through the one preference store: applied at once, saved to the account. */
export function useTextSize(): [size: TextSize, setSize: (size: TextSize) => void] {
  const size = useSyncExternalStore(subscribe, getTextSize);
  return [size, setTextSize];
}

function setTextSize(size: TextSize): void {
  savePreference("textSize", size);
}
