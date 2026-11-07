import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameTile, HomeSnapshot, SessionTile } from "../api/types";
import { HomeScreen } from "./HomeScreen";

afterEach(cleanup);

const EVENING = new Date(2026, 0, 5, 19, 0, 0);

function tile(i: number, over: Partial<SessionTile> = {}): SessionTile {
  return {
    id: `s${i}`,
    invite_id: `i${i}`,
    kind: "learning",
    title: `Session ${i}`,
    host: { id: "h", name: "Ada" },
    live: false,
    participant_count: 0,
    participants: [],
    last_active_at: null,
    has_preview: false,
    ...over,
  };
}

function snap(over: Partial<HomeSnapshot> = {}): HomeSnapshot {
  return {
    user: { first_name: null, display_name: null, username: "mo" },
    live_participant_count: 2,
    sessions: [tile(1)],
    idle_total: 1,
    games: [],
    ...over,
  };
}

function setup(s: HomeSnapshot, extra: Partial<Parameters<typeof HomeScreen>[0]> = {}) {
  const props = {
    snapshot: s,
    now: EVENING,
    onStart: vi.fn(),
    onOpenSession: vi.fn(),
    onOpenGame: vi.fn(),
    onShowMore: vi.fn(),
    ...extra,
  };
  const r = render(<HomeScreen {...props} />);
  return { ...props, ...r };
}

describe("HomeScreen", () => {
  it("FR-1: greets the user by name, good evening, two people coding", () => {
    setup(snap());
    expect(screen.getByRole("heading", { name: "Good evening, mo" })).toBeTruthy();
    expect(screen.getByText("2 people are coding right now")).toBeTruthy();
  });

  it("FR-2: the Start tile is first in DOM order and calls the start action", () => {
    const { onStart } = setup(snap());
    const grid = screen.getByRole("list");
    const first = within(grid).getAllByRole("button")[0] as HTMLElement;
    expect(first.getAttribute("aria-label") ?? first.textContent).toMatch(/start session/i);
    fireEvent.click(screen.getByRole("button", { name: /start session/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("opens a session tile and a game tile", () => {
    const g: GameTile = {
      id: "g1",
      invite_id: "gi1",
      title: "Chess",
      opponent: null,
      status: "waiting",
      turn: "none",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    };
    const { onOpenSession, onOpenGame } = setup(snap({ games: [g] }));
    fireEvent.click(screen.getByRole("button", { name: /Session 1/ }));
    expect(onOpenSession).toHaveBeenCalledWith("s1");
    fireEvent.click(screen.getByRole("button", { name: /Chess/ }));
    expect(onOpenGame).toHaveBeenCalledWith("g1");
  });

  it("FR-3: more than 8 idle sessions shows a Show more tile; 8 does not", () => {
    const many = Array.from({ length: 8 }, (_, i) => tile(i + 1));
    const { onShowMore, unmount } = setup(snap({ sessions: many, idle_total: 12 }));
    fireEvent.click(screen.getByRole("button", { name: /show more/i }));
    expect(onShowMore).toHaveBeenCalledTimes(1);
    unmount();
    setup(snap({ sessions: many, idle_total: 8 }));
    expect(screen.queryByRole("button", { name: /show more/i })).toBeNull();
  });

  it("FR-6: no games means no Games tile", () => {
    setup(snap());
    expect(screen.queryByRole("button", { name: /chess|game/i })).toBeNull();
  });

  it("FR-8: no sessions or games shows the empty state and the Start tile", () => {
    setup(snap({ sessions: [], idle_total: 0, games: [], live_participant_count: null }));
    expect(screen.getByText(/start a session/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /start session/i })).toBeTruthy();
    expect(screen.getByText("Nobody is live right now")).toBeTruthy();
  });

  it("Accessibility: the count is in a polite live region whose text node is untouched on same-count re-render", () => {
    const { rerender, ...p } = setup(snap());
    const region = document.querySelector("[aria-live='polite']") as HTMLElement;
    expect(region.textContent).toBe("2 people are coding right now");
    const node = region.firstChild;
    rerender(
      <HomeScreen {...p} snapshot={snap({ sessions: [tile(1), tile(2)], idle_total: 2 })} />,
    );
    expect(region.firstChild).toBe(node);
    rerender(<HomeScreen {...p} snapshot={snap({ live_participant_count: 3 })} />);
    expect(region.textContent).toBe("3 people are coding right now");
  });
});
