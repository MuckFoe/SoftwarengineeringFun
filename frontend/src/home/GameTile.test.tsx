import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChessGameTile, RpsGameTile } from "../api/types";
import { GameTile } from "./GameTile";

afterEach(cleanup);

const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i}`, name: `P${i}`, avatar_url: null }));

/** Side a on rows 0-1 (hidden except a revealed rock on 8), side b on rows 4-5. */
function board(): RpsGameTile["board"] {
  const cells: RpsGameTile["board"] = Array.from({ length: 42 }, () => null);
  for (let sq = 0; sq < 14; sq++) cells[sq] = { side: "a", kind: null };
  for (let sq = 28; sq < 42; sq++) cells[sq] = { side: "b", kind: null };
  cells[8] = { side: "a", kind: "rock" };
  cells[29] = { side: "b", kind: "scissors" };
  return cells;
}

function rps(over: Partial<RpsGameTile> = {}): RpsGameTile {
  return {
    game: "rps",
    id: "r1",
    invite_id: "ri1",
    title: "Rock Paper Siege",
    starter: { id: "s", name: "Ann" },
    status: "in_progress",
    turn: "opponent",
    live: true,
    participant_count: 3,
    participants: people(3),
    board: board(),
    ...over,
  };
}

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const chess: ChessGameTile = {
  id: "g1",
  invite_id: "gi1",
  title: "Chess",
  opponent: { id: "o", name: "Bob" },
  status: "in_progress",
  turn: "you",
  fen: FEN,
};

describe("GameTile rps variant (AC-24, FR-25)", () => {
  it("shows name, starter, Live state, participant count and avatars", () => {
    render(<GameTile tile={rps()} onOpen={() => {}} />);
    const b = screen.getByRole("button", {
      name: "Rock Paper Siege, started by Ann, Live, 3 people",
    });
    expect(b.tagName).toBe("BUTTON");
    expect(b.textContent).toContain("Rock Paper Siege");
    expect(b.textContent).toContain("Ann");
    expect(b.textContent).toMatch(/Live\s*3/);
    expect(b.querySelectorAll("[data-avatar]").length).toBe(3);
  });

  it("not live: no Live badge and no avatars", () => {
    render(
      <GameTile
        tile={rps({ live: false, participant_count: 0, participants: [] })}
        onOpen={() => {}}
      />,
    );
    const b = screen.getByRole("button", { name: /^Rock Paper Siege, started by Ann, idle/ });
    expect(b.textContent).not.toMatch(/Live/);
    expect(b.querySelectorAll("[data-avatar]").length).toBe(0);
  });

  it("one person reads singular", () => {
    render(
      <GameTile tile={rps({ participant_count: 1, participants: people(1) })} onOpen={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /Live, 1 person$/ })).toBeTruthy();
  });

  it("preview is a 7×6 aria-hidden board; kind null renders hidden, revealed kinds show", () => {
    const { container } = render(<GameTile tile={rps()} onOpen={() => {}} />);
    const preview = container.querySelector("[data-rps-preview]");
    expect(preview).not.toBeNull();
    expect(preview?.getAttribute("aria-hidden")).toBe("true");
    const cells = container.querySelectorAll("[data-rps-preview] [data-square]");
    expect(cells.length).toBe(42);
    const at = (sq: number) => container.querySelector(`[data-rps-preview] [data-square="${sq}"]`);
    expect(at(0)?.getAttribute("data-piece")).toBe("a-hidden");
    expect(at(8)?.getAttribute("data-piece")).toBe("a-rock");
    expect(at(29)?.getAttribute("data-piece")).toBe("b-scissors");
    expect(at(41)?.getAttribute("data-piece")).toBe("b-hidden");
    expect(at(20)?.hasAttribute("data-piece")).toBe(false);
    expect(at(20)?.querySelector("svg")).toBeNull();
    expect(at(0)?.querySelector("svg path")?.getAttribute("d")).toBeTruthy();
    // Nothing in the preview is focusable.
    expect(preview?.querySelector("[tabindex], button, a, input")).toBeNull();
  });

  it("preview draws hidden cells with the hidden figure, identical per side (AC-24, AC-28)", () => {
    const { container } = render(<GameTile tile={rps()} onOpen={() => {}} />);
    const at = (sq: number) => container.querySelector(`[data-rps-preview] [data-square="${sq}"]`);
    const fig = (sq: number) => at(sq)?.querySelector("svg[data-side]");
    expect(fig(0)?.getAttribute("data-side")).toBe("a");
    expect(fig(0)?.getAttribute("viewBox")).toBe("0 -1.5 48 50");
    expect(fig(41)?.getAttribute("data-side")).toBe("b");
    // Two hidden cells of one side render identical markup.
    expect(at(0)?.innerHTML).toBe(at(1)?.innerHTML);
    expect(at(30)?.innerHTML).toBe(at(41)?.innerHTML);
    // A revealed piece differs from the hidden figure.
    expect(at(8)?.innerHTML).not.toBe(at(0)?.innerHTML);
    // The preview names nothing: no titles inside.
    expect(container.querySelector("[data-rps-preview] title")).toBeNull();
  });

  it("preview cells mark home and middle rows (AC-29, FR-28)", () => {
    const { container } = render(<GameTile tile={rps()} onOpen={() => {}} />);
    const zone = (sq: number) =>
      container
        .querySelector(`[data-rps-preview] [data-square="${sq}"]`)
        ?.getAttribute("data-zone");
    expect(zone(0)).toBe("home-bottom");
    expect(zone(13)).toBe("home-bottom");
    expect(zone(14)).toBe("middle");
    expect(zone(27)).toBe("middle");
    expect(zone(28)).toBe("home-top");
    expect(zone(41)).toBe("home-top");
  });

  it("preview has side a at the bottom: square 0 is bottom-left, 41 top-right", () => {
    const { container } = render(<GameTile tile={rps()} onOpen={() => {}} />);
    const order = [...container.querySelectorAll("[data-rps-preview] [data-square]")].map((c) =>
      Number(c.getAttribute("data-square")),
    );
    expect(order[0]).toBe(35);
    expect(order[6]).toBe(41);
    expect(order[35]).toBe(0);
    expect(order[41]).toBe(6);
  });

  it("click opens the session once", () => {
    const onOpen = vi.fn();
    render(<GameTile tile={rps()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("r1");
  });

  it("chess tiles unchanged: name, 64-square preview, no rps preview", () => {
    const { container } = render(<GameTile tile={chess} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "Chess, against Bob, your turn" })).toBeTruthy();
    expect(container.querySelectorAll("[data-square]").length).toBe(64);
    expect(container.querySelector("[data-rps-preview]")).toBeNull();
  });

  it("chess tile with explicit game: 'chess' renders as chess", () => {
    render(<GameTile tile={{ ...chess, game: "chess" }} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "Chess, against Bob, your turn" })).toBeTruthy();
  });
});
