import { useEffect, useState } from "react";
import { getMe } from "../api/client";
import type { Me } from "../api/types";

export type MeState =
  | { status: "loading" }
  | { status: "ready"; me: Me }
  | { status: "error"; error: unknown };

/** Loads `/api/me` once per mount. */
export function useMe(): MeState {
  const [state, setState] = useState<MeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getMe().then(
      (me) => {
        if (!cancelled) setState({ status: "ready", me });
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
