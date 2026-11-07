import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameTile as GameTileData, SessionTile as SessionTileData } from "../api/types";
import { GameTile } from "./GameTile";
import { SessionTile } from "./SessionTile";

afterEach(cleanup);

const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i}`, name: `P${i}`, avatar_url: null }));

function session(over: Partial<SessionTileData> = {}): SessionTileData {
  return {
    id: "s1",
    invite_id: "i1",
    kind: "coding",
    title: "Two sum",
    host: { id: "h", name: "Ada" },
    live: true,
    participant_count: 3,
    participants: people(3),
    last_active_at: null,
    has_preview: false,
    ...over,
  };
}

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
function game(over: Partial<GameTileData> = {}): GameTileData {
  return {
    id: "g1",
    invite_id: "gi1",
    title: "Chess",
    opponent: { id: "o", name: "Bob" },
    status: "in_progress",
    turn: "you",
    fen: FEN,
    ...over,
  };
}

describe("SessionTile", () => {
  it("FR-3: live tile shows Live, count and avatars; name matches spec", () => {
    render(<SessionTile tile={session()} onOpen={() => {}} />);
    const b = screen.getByRole("button", { name: "Two sum, hosted by Ada, Live, 3 people" });
    expect(b.textContent).toContain("Live");
    expect(b.textContent).toContain("3");
    expect(b.querySelectorAll("[data-avatar]").length).toBe(3);
  });

  it("FR-3: at most 4 avatars; singular person", () => {
    const { rerender } = render(
      <SessionTile
        tile={session({ participant_count: 6, participants: people(6) })}
        onOpen={() => {}}
      />,
    );
    expect(document.querySelectorAll("[data-avatar]").length).toBe(4);
    rerender(
      <SessionTile
        tile={session({ participant_count: 1, participants: people(1) })}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Live, 1 person$/ })).toBeTruthy();
  });

  it("FR-3: idle tile shows last-active time and no Live tag", () => {
    const at = new Date(Date.now() - 2 * 3600_000).toISOString();
    render(
      <SessionTile
        tile={session({ live: false, participant_count: 0, participants: [], last_active_at: at })}
        onOpen={() => {}}
      />,
    );
    const b = screen.getByRole("button", { name: "Two sum, hosted by Ada, idle" });
    expect(b.textContent).not.toContain("Live");
    expect(b.querySelector("time")?.textContent).toMatch(/2 h/);
  });

  it("FR-5: click calls open once; native button so Enter/Space activate it", () => {
    const onOpen = vi.fn();
    render(<SessionTile tile={session()} onOpen={onOpen} />);
    const b = screen.getByRole("button");
    expect(b.tagName).toBe("BUTTON");
    expect(b.getAttribute("type")).toBe("button");
    fireEvent.click(b);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("s1");
  });

  it("one tab stop; preview slotted only when given and hidden from AT", () => {
    const { container, rerender } = render(<SessionTile tile={session()} onOpen={() => {}} />);
    expect(container.querySelector("pre")).toBeNull();
    rerender(<SessionTile tile={session()} preview="print(1)" onOpen={() => {}} />);
    expect(container.querySelector("pre")?.textContent).toBe("print(1)");
    expect(container.querySelectorAll("button, a, [tabindex='0']").length).toBe(1);
    expect(
      screen.getByRole("button", { name: "Two sum, hosted by Ada, Live, 3 people" }),
    ).toBeTruthy();
  });

  it("shows kind", () => {
    render(<SessionTile tile={session({ kind: "learning" })} onOpen={() => {}} />);
    expect(screen.getByRole("button").textContent).toMatch(/learning/i);
  });
});

describe("GameTile", () => {
  it.each([
    ["you", "in_progress", "your turn"],
    ["opponent", "in_progress", "opponent's turn"],
    ["none", "waiting", "waiting"],
  ] as const)("FR-6: %s/%s -> %s", (turn, status, text) => {
    const { container } = render(<GameTile tile={game({ turn, status })} onOpen={() => {}} />);
    const b = screen.getByRole("button", { name: `Chess, against Bob, ${text}` });
    expect(b.textContent).toContain("Bob");
    expect(b.textContent?.toLowerCase()).toContain(text);
    expect(container.querySelectorAll("[data-square]").length).toBe(64);
  });

  it("FR-6: click opens the game once; native button", () => {
    const onOpen = vi.fn();
    render(<GameTile tile={game()} onOpen={onOpen} />);
    const b = screen.getByRole("button");
    expect(b.tagName).toBe("BUTTON");
    fireEvent.click(b);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("g1");
  });

  it("a game with no opponent yet has a name and no crash", () => {
    render(
      <GameTile
        tile={game({ opponent: null, turn: "none", status: "waiting" })}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Chess, waiting for an opponent" })).toBeTruthy();
  });
});
