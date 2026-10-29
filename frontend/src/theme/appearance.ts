/**
 * The user's appearance choice (FR-5, FR-6). Pure apart from `localStorage`, whose
 * failures (private mode, blocked storage) fall back to "system". The inline script in
 * `index.html` applies the same rules before first paint; keep the two in step.
 */
export type Choice = "light" | "dark" | "system";

const KEY = "appearance";

export function resolve(choice: Choice, osDark: boolean): "light" | "dark" {
  if (choice === "system") return osDark ? "dark" : "light";
  return choice;
}

export function loadChoice(): Choice {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function saveChoice(c: Choice): void {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    // Storage unavailable: the choice still applies for this page, it just isn't kept.
  }
}
