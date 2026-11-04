import { useEffect, useState } from "react";
import { getMe } from "../api/client";
import type { Me } from "../api/types";
import { syncOnLoad } from "../prefs/accountPrefs";

export type MeState =
  | { status: "loading" }
  | { status: "ready"; me: Me }
  | { status: "error"; error: unknown };

/** Loads `/api/me` once per mount, and reconciles preferences with the account (spec 012). */
export function useMe(): MeState {
  const [state, setState] = useState<MeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getMe().then(
      (me) => {
        if (cancelled) return;
        syncOnLoad(me);
        setState({ status: "ready", me });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: "error", error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
