import { useEffect, useState, useSyncExternalStore } from "react";
import { getAppearance, osIsDark, savePreference, subscribe } from "../prefs/accountPrefs";
import { type Choice, resolve } from "./appearance";

const QUERY = "(prefers-color-scheme: dark)";

function setChoice(c: Choice): void {
  savePreference("appearance", c);
}

/**
 * The appearance choice and what it resolves to (FR-5, FR-6). Reads the one preference
 * store (spec 012 FR-18), keeps `<html data-appearance>` in step and follows the OS live
 * while the choice is System.
 */
export function useAppearance(): {
  choice: Choice;
  resolved: "light" | "dark";
  setChoice(c: Choice): void;
} {
  const choice = useSyncExternalStore(subscribe, getAppearance);
  const [osDark, setOsDark] = useState(osIsDark);
  const resolved = resolve(choice, osDark);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setOsDark(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-appearance", resolved);
  }, [resolved]);

  return { choice, resolved, setChoice };
}
