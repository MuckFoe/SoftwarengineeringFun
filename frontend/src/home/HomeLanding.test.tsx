import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameTile, HomeSnapshot } from "../api/types";
import { HomeLanding } from "./HomeLanding";

const feed = vi.hoisted(() => ({ snapshot: null as unknown }));

vi.mock("../auth/useMe", () => ({
  useMe: () => ({ status: "ready", me: { signed_in: true } }),
}));
vi.mock("./useHomeFeed", () => ({
  useHomeFeed: () => ({ snapshot: feed.snapshot, loading: false, error: null, refresh: () => {} }),
}));
vi.mock("../pages/ProblemsWindow", () => ({ ProblemsWindow: () => <p>problems</p> }));
vi.mock("../ui/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("../ui/Window", () => ({ Window: ({ children }: { children: ReactNode }) => children }));
vi.mock("./HomeScreen", () => ({
  HomeScreen: (p: { snapshot: HomeSnapshot; onOpenGame: (id: string) => void }) =>
    p.snapshot.games.map((g) => (
      <button key={g.id} type="button" onClick={() => p.onOpenGame(g.id)}>
        {g.id}
      </button>
    )),
}));

afterEach(cleanup);

const chess: GameTile = {
  id: "g1",
  invite_id: "chess-inv",
  title: "Chess",
  opponent: null,
  status: "waiting",
  turn: "none",
  fen: "8/8/8/8/8/8/8/8 w - - 0 1",
};

const rps: GameTile = {
  game: "rps",
  id: "g2",
  invite_id: "rps inv",
  title: "Rock Paper Siege",
  starter: { id: "u", name: "Ada" },
  status: "in_progress",
  turn: "you",
  live: true,
  participant_count: 2,
  participants: [],
  board: Array(42).fill(null),
};

function Where() {
  const loc = useLocation();
  return <output>{loc.pathname}</output>;
}

function setup(games: GameTile[]) {
  feed.snapshot = {
    user: { first_name: null, display_name: null, username: "mo" },
    live_participant_count: null,
    sessions: [],
    idle_total: 0,
    games,
  } satisfies HomeSnapshot;
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<HomeLanding />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("HomeLanding opens game tiles by game (spec 021 AC-24)", () => {
  it("AC-24: activating an rps tile navigates to /games/rps/s/<invite>", () => {
    setup([chess, rps]);
    fireEvent.click(screen.getByRole("button", { name: "g2" }));
    expect(screen.getByRole("status").textContent).toBe("/games/rps/s/rps%20inv");
  });

  it("a chess tile, with or without `game`, still opens the chess route", () => {
    setup([chess]);
    fireEvent.click(screen.getByRole("button", { name: "g1" }));
    expect(screen.getByRole("status").textContent).toBe("/games/chess/s/chess-inv");
  });
});
