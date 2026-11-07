import { useEffect, useMemo, useState } from "react";
import { getMySessions, searchProblems } from "../api/client";
import type { ProblemSummary, RecentSession } from "../api/types";
import { AREAS } from "../components/AreaNav";
import type { JumpItem } from "./jump";

const SESSION_ROUTE: Record<RecentSession["kind"], string> = {
  coding: "/s/",
  learning: "/learn/s/",
  presentation: "/present/s/",
  chess: "/games/chess/s/",
};

/**
 * Everything the jump bar can open, from lists the app already fetches (FR-15): the static areas,
 * the recent sessions and the problems. The two lists load once, the first time `open` is true,
 * through the same requests the Problems and Profile screens make. No search endpoint.
 */
export function useJumpIndex(open: boolean): { items: JumpItem[] } {
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    getMySessions().then(setSessions, () => {});
    searchProblems("").then(setProblems, () => {});
  }, [open, loaded]);

  const items = useMemo<JumpItem[]>(
    () => [
      ...AREAS.map((a) => ({ kind: "area" as const, id: a.to, label: a.title, to: a.to })),
      ...sessions.map((s) => ({
        kind: "session" as const,
        id: s.invite_id,
        label: s.title,
        to: `${SESSION_ROUTE[s.kind]}${s.invite_id}`,
      })),
      ...problems.map((p) => ({ kind: "problem" as const, id: p.id, label: p.title, to: "/" })),
    ],
    [sessions, problems],
  );
  return { items };
}
