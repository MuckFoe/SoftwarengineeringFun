import { useCallback, useEffect, useState } from "react";
import { type Choice, loadChoice, resolve, saveChoice } from "./appearance";

const QUERY = "(prefers-color-scheme: dark)";
/** Fired on `window` when the choice changes, so every caller of the hook agrees. */
const CHANGED = "appearancechoice";

/** Whether the OS is dark now; without matchMedia, whatever the pre-paint script decided. */
function osIsDark(): boolean {
  if (typeof window.matchMedia === "function") return window.matchMedia(QUERY).matches;
  return document.documentElement.getAttribute("data-appearance") === "dark";
}

/**
 * The appearance choice and what it resolves to (FR-5, FR-6). Keeps
 * `<html data-appearance>` in step and follows the OS live while the choice is System.
 */
export function useAppearance(): {
  choice: Choice;
  resolved: "light" | "dark";
  setChoice(c: Choice): void;
} {
  const [choice, setChoiceState] = useState<Choice>(loadChoice);
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
    const onChosen = (e: Event) => setChoiceState((e as CustomEvent<Choice>).detail);
    window.addEventListener(CHANGED, onChosen);
    return () => window.removeEventListener(CHANGED, onChosen);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-appearance", resolved);
  }, [resolved]);

  const setChoice = useCallback((c: Choice) => {
    saveChoice(c);
    setChoiceState(c);
    window.dispatchEvent(new CustomEvent(CHANGED, { detail: c }));
    // Applied at once, before React re-renders (FR-6 "immediately").
    document.documentElement.setAttribute("data-appearance", resolve(c, osIsDark()));
  }, []);

  return { choice, resolved, setChoice };
}
