import { useEffect, useState } from "react";
import { getHomePreview } from "../api/client";

export const PREVIEW_REFRESH_MS = 15000;

/**
 * Lazily loads a tile's code excerpt (spec 017). Fetches after the tile has rendered, so tiles
 * never wait on previews. 204 and 404 (and any error) mean "no preview". Refetches when
 * `hasPreview` flips true and every 15 s while the session is live.
 */
export function usePreview(
  sessionId: string,
  hasPreview: boolean,
  live: boolean,
  enabled = true,
): string | null {
  const [excerpt, setExcerpt] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !hasPreview) {
      setExcerpt(null);
      return;
    }
    let alive = true;
    const load = () => {
      getHomePreview(sessionId).then(
        (p) => alive && setExcerpt(p?.excerpt || null),
        () => alive && setExcerpt(null),
      );
    };
    load();
    const timer = live ? setInterval(load, PREVIEW_REFRESH_MS) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId, hasPreview, live, enabled]);

  return excerpt;
}
