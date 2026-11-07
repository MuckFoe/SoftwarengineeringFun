import { useCallback, useEffect, useRef, useState } from "react";
import { getHome } from "../api/client";
import type { HomeSnapshot } from "../api/types";

export const POLL_MS = 5000;
export const DEBOUNCE_MS = 1000;

export interface HomeFeed {
  snapshot: HomeSnapshot | null;
  loading: boolean;
  error: unknown;
  /** Debounced (1 s, trailing) refetch of /api/home. */
  refresh: () => void;
}

const isVisible = () => document.visibilityState !== "hidden";

/**
 * Home screen feed (spec 017). Fetches /api/home on mount and polls every 5 s while the
 * document is visible. It never waits on previews: loading ends when /api/home resolves.
 */
export function useHomeFeed(rejoinToken?: string | null): HomeFeed {
  const [snapshot, setSnapshot] = useState<HomeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const alive = useRef(true);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(() => {
    getHome(rejoinToken).then(
      (s) => {
        if (!alive.current) return;
        setSnapshot(s);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (!alive.current) return;
        setError(e);
        setLoading(false);
      },
    );
  }, [rejoinToken]);

  const refresh = useCallback(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(load, DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    alive.current = true;
    let poll: ReturnType<typeof setInterval> | undefined;
    const startPolling = () => {
      clearInterval(poll);
      poll = setInterval(load, POLL_MS);
    };
    const onVisibility = () => {
      if (isVisible()) {
        refresh();
        startPolling();
      } else {
        clearInterval(poll);
        poll = undefined;
      }
    };
    load();
    if (isVisible()) startPolling();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive.current = false;
      clearInterval(poll);
      clearTimeout(debounce.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, refresh]);

  return { snapshot, loading, error, refresh };
}
