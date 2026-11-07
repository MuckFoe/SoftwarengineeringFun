import { useEffect, useState } from "react";
import { getMySessions } from "../api/client";
import type { RecentSession } from "../api/types";
import { useMe } from "../auth/useMe";

/** True when any session row is live (spec 016 FR-2, FR-5). */
export const anyLive = (rows: RecentSession[]): boolean => rows.some((r) => r.live === true);

/** Whether any session the user can see is live, from the list the app already fetches. */
export function useAnyLive(): boolean {
  const me = useMe();
  const signedIn = me.status === "ready" && me.me.signed_in;
  const [live, setLive] = useState(false);
  useEffect(() => {
    // Anonymous visitors have no session list: do not ask (it would be a 401 on every screen).
    if (!signedIn) {
      setLive(false);
      return;
    }
    let cancelled = false;
    getMySessions().then(
      (rows) => !cancelled && setLive(Array.isArray(rows) && anyLive(rows)),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [signedIn]);
  return live;
}
