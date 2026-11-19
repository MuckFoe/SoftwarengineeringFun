import { useMemo } from "react";
import { useNavigate } from "react-router";
import type { HomeSnapshot } from "../api/types";
import { useMe } from "../auth/useMe";
import { AppHeader } from "../ui/AppHeader";
import { Window } from "../ui/Window";
import { HomeScreen } from "./HomeScreen";
import { findRejoinToken } from "./rejoinToken";
import { useHomeFeed } from "./useHomeFeed";

const KIND_ROUTE = {
  coding: "/s/",
  learning: "/learn/s/",
  presentation: "/present/s/",
} as const;

/** Spec 021 FR-25: a game tile opens its own game's route; tiles without `game` are chess. */
const GAME_ROUTE = { chess: "/games/chess/s/", rps: "/games/rps/s/" } as const;

/** A home with nothing of anyone's in it: a nameless greeting and the Start session tile. */
const EMPTY_HOME: HomeSnapshot = {
  user: { first_name: null, display_name: null, username: "" },
  live_participant_count: null,
  sessions: [],
  idle_total: 0,
  games: [],
};

/**
 * The landing at `/` (spec 017 FR-10, FR-11, FR-12). An account, or a guest or invitee holding a
 * rejoin token, gets their home tiles. A visitor who is neither gets the empty home without
 * asking the server, and a home that /api/home refuses or cannot answer is the empty home with a
 * notice. `/` is never the problem library (FR-12, 2026-11-19).
 */
export function HomeLanding() {
  const me = useMe();
  const token = useMemo(findRejoinToken, []);
  if (me.status === "loading") return null;
  const signedIn = me.status === "ready" && me.me.signed_in;
  if (!signedIn && token === null) return <HomeView snapshot={EMPTY_HOME} />;
  return <FedHome token={signedIn ? null : token} />;
}

function FedHome({ token }: { token: string | null }) {
  const { snapshot, loading, error } = useHomeFeed(token);
  if (loading) return null;
  if (snapshot === null || error)
    return <HomeView snapshot={EMPTY_HOME} notice="Your sessions couldn't be loaded right now." />;
  return <HomeView snapshot={snapshot} />;
}

function HomeView({ snapshot, notice }: { snapshot: HomeSnapshot; notice?: string }) {
  const navigate = useNavigate();
  const open = (path: string, invite: string | undefined) =>
    invite && navigate(`${path}${encodeURIComponent(invite)}`);
  return (
    <Window toolbar={<AppHeader label="Home" />}>
      <HomeScreen
        snapshot={snapshot}
        notice={notice}
        onStart={() => navigate("/problems")}
        onOpenSession={(id) => {
          const s = snapshot.sessions.find((t) => t.id === id);
          if (s) open(KIND_ROUTE[s.kind], s.invite_id);
        }}
        onOpenGame={(id) => {
          const g = snapshot.games.find((t) => t.id === id);
          if (g) open(GAME_ROUTE[g.game ?? "chess"], g.invite_id);
        }}
        onShowMore={() => navigate("/profile")}
      />
    </Window>
  );
}
