import { useCallback, useEffect, useRef, useState } from "react";
import type { GifResult, GifResultsMessage, GifSearchMessage } from "../../api/types";

export type GifSearchStatus = "idle" | "loading" | "results" | "unavailable" | "rate_limited";

/** Debounce between the last keystroke and the `gif_search` it sends (spec 007 plan). */
export const SEARCH_DEBOUNCE_MS = 400;

/** The refusal of a `gif_search`, as far as GIF search reads it. */
export interface GifSearchError {
  code: string;
  request_id?: string;
  retry_after?: number;
}

/** The events GIF search subscribes to (`closed` carries whatever the socket reports). */
export interface GifSearchEvents {
  gif_results: GifResultsMessage;
  error: GifSearchError;
  closed: unknown;
}

/**
 * The socket GIF search talks over (spec 013 plan, Chat — frontend reuse): a coding session's
 * `CollabProvider` and a presentation's `PresentSocket` both satisfy it.
 */
export interface GifSearchTransport {
  send(message: GifSearchMessage): void;
  on<K extends keyof GifSearchEvents>(
    type: K,
    handler: (payload: GifSearchEvents[K]) => void,
  ): () => void;
}

interface SearchState {
  status: GifSearchStatus;
  results: GifResult[];
  trending: boolean;
  retryAfter: number | null;
}

const IDLE: SearchState = { status: "idle", results: [], trending: false, retryAfter: null };

/**
 * GIF search over the session socket (spec 007 plan, Frontend — `chat/gifs/useGifSearch.ts`).
 * When `enabled` becomes true it searches the current term (empty: trending) at once; after
 * that, 400 ms after the last `setQuery`. Each request carries a `request_id`, and replies to
 * anything but the latest are ignored. Nothing is sent while `enabled` is false (FR-5).
 */
export function useGifSearch({
  provider,
  enabled,
}: {
  provider: GifSearchTransport | null;
  enabled: boolean;
}) {
  const [query, setQueryState] = useState("");
  const [state, setState] = useState<SearchState>(IDLE);
  const queryRef = useRef("");
  const latest = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = enabled && provider !== null;

  const search = useCallback(
    (q: string) => {
      if (!provider) return;
      const requestId = crypto.randomUUID();
      latest.current = requestId;
      setState((s) => ({ ...s, status: "loading", retryAfter: null }));
      provider.send({ type: "gif_search", request_id: requestId, q });
    },
    [provider],
  );

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    if (!active || !provider) return;
    const offs = [
      provider.on("gif_results", (m) => {
        if (m.request_id !== latest.current) return;
        setState({ status: "results", results: m.results, trending: m.trending, retryAfter: null });
      }),
      provider.on("error", (m) => {
        if (m.request_id === undefined || m.request_id !== latest.current) return;
        if (m.code === "gif_unavailable") {
          setState((s) => ({ ...s, status: "unavailable", retryAfter: null }));
        } else if (m.code === "gif_rate_limited") {
          setState((s) => ({ ...s, status: "rate_limited", retryAfter: m.retry_after ?? null }));
        }
      }),
    ];
    search(queryRef.current);
    return () => {
      for (const off of offs) off();
      clearTimer();
      latest.current = null;
      setState(IDLE);
    };
  }, [active, provider, search, clearTimer]);

  const setQuery = useCallback(
    (q: string) => {
      queryRef.current = q;
      setQueryState(q);
      clearTimer();
      if (!active) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        search(q);
      }, SEARCH_DEBOUNCE_MS);
    },
    [active, search, clearTimer],
  );

  return { query, setQuery, ...state };
}
