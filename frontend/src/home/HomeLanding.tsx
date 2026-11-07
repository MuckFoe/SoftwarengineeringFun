import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useMe } from "../auth/useMe";
import { ProblemsWindow } from "../pages/ProblemsWindow";
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

/**
 * The landing at `/` (spec 017 FR-10, FR-11). An account, or a guest or invitee holding a
 * rejoin token, gets the home tiles. Anyone else, or anyone /api/home refuses or cannot
 * answer, keeps the problem library the landing was before.
 */
export function HomeLanding() {
  const me = useMe();
  const token = useMemo(findRejoinToken, []);
  if (me.status === "loading") return null;
  const signedIn = me.status === "ready" && me.me.signed_in;
  if (!signedIn && token === null) return <ProblemsWindow />;
  return <Home token={signedIn ? null : token} />;
}

function Home({ token }: { token: string | null }) {
  const navigate = useNavigate();
  const { snapshot, loading, error } = useHomeFeed(token);
  if (loading) return null;
  if (snapshot === null || error) return <ProblemsWindow />;
  const open = (path: string, invite: string | undefined) =>
    invite && navigate(`${path}${encodeURIComponent(invite)}`);
  return (
    <Window toolbar={<AppHeader label="Home" />}>
      <HomeScreen
        snapshot={snapshot}
        onStart={() => navigate("/problems")}
        onOpenSession={(id) => {
          const s = snapshot.sessions.find((t) => t.id === id);
          if (s) open(KIND_ROUTE[s.kind], s.invite_id);
        }}
        onOpenGame={(id) =>
          open("/games/chess/s/", snapshot.games.find((g) => g.id === id)?.invite_id)
        }
        onShowMore={() => navigate("/profile")}
      />
    </Window>
  );
}
