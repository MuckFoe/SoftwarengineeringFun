import { useCallback, useState } from "react";

/**
 * A pinned panel's size in px (a sidebar's width, the run results' height), remembered per
 * browser under `panelSize.<key>` in `localStorage`. Storage failures never throw: the size
 * still applies for this page, it just isn't kept.
 */
export const SIZE_STORAGE_PREFIX = "panelSize.";

function load(key: string, defaultSize: number): number {
  try {
    const stored = Number(localStorage.getItem(SIZE_STORAGE_PREFIX + key));
    return Number.isFinite(stored) && stored > 0 ? stored : defaultSize;
  } catch {
    return defaultSize;
  }
}

/** `[size, setSize]` for one panel; `key` names it, e.g. "sidebar", "output". */
export function usePanelSize(
  key: string,
  defaultSize: number,
): [size: number, setSize: (size: number) => void] {
  const [size, setState] = useState(() => load(key, defaultSize));
  const setSize = useCallback(
    (next: number) => {
      const rounded = Math.round(next);
      setState(rounded);
      try {
        localStorage.setItem(SIZE_STORAGE_PREFIX + key, String(rounded));
      } catch {
        // Storage unavailable: kept for this page only.
      }
    },
    [key],
  );
  return [size, setSize];
}
