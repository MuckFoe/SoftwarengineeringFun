import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Board } from "./Board";
import type { Role } from "./chessState";
import type { Color, Game } from "./chessTypes";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function game(over: Partial<Game> = {}): Game {
  return {
    status: "in_progress",
    fen: START,
    turn: "white",
    ply: 0,
    moves: [],
    last_move: null,
    check_square: null,
    legal: { g1: ["f3", "h3"], e2: ["e3", "e4"] },
    promotions: [],
    draw_offer_by: null,
    claim_available_to: null,
    result: null,
    reason: null,
    ...over,
  };
}

function Harness(p: {
  game: Game;
  seat: Role;
  bottom?: Color;
  onMove: (f: string, t: string) => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  return (
    <Board
      game={p.game}
      seat={p.seat}
      bottom={p.bottom ?? (p.seat === "black" ? "black" : "white")}
      selected={sel}
      onSelect={(s) => setSel((cur) => (s === cur ? null : s))}
      onMove={p.onMove}
    />
  );
}

const sq = (name: string) => screen.getByRole("gridcell", { name: new RegExp(`^${name},`) });
const marked = (what: string) =>
  screen
    .queryAllByRole("gridcell")
    .filter((b) => (b.getAttribute("aria-label") ?? "").includes(what))
    .map((b) => (b.getAttribute("aria-label") ?? "").slice(0, 2))
    .sort();

afterEach(cleanup);

const click = (el: HTMLElement) => fireEvent.click(el);
const key = (k: string) => fireEvent.keyDown(document.activeElement as HTMLElement, { key: k });

describe("Board", () => {
  it("AC-13: picking g1 marks f3 and h3 only", () => {
    render(<Harness game={game()} seat="white" onMove={vi.fn()} />);
    click(sq("g1"));
    expect(marked("legal move")).toEqual(["f3", "h3"]);
  });

  it("AC-12: black, a viewer, or a black piece cannot be selected or moved", () => {
    const onMove = vi.fn();
    for (const seat of ["black", "viewer"] as Role[]) {
      render(<Harness game={game()} seat={seat} onMove={onMove} />);
      click(sq("g1"));
      click(sq("f3"));
      expect(marked("legal move")).toEqual([]);
      cleanup();
    }
    render(<Harness game={game({ legal: { g8: ["f6"] } })} seat="white" onMove={onMove} />);
    click(sq("g8"));
    expect(marked("legal move")).toEqual([]);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("no selection once the game has ended", () => {
    render(<Harness game={game({ status: "ended" })} seat="white" onMove={vi.fn()} />);
    click(sq("g1"));
    expect(marked("legal move")).toEqual([]);
  });

  it("click then click moves; drag shares the path", () => {
    const onMove = vi.fn();
    render(<Harness game={game()} seat="white" onMove={onMove} />);
    click(sq("e2"));
    click(sq("e4"));
    expect(onMove).toHaveBeenLastCalledWith("e2", "e4");
    fireEvent.pointerDown(sq("g1"));
    fireEvent.pointerUp(sq("f3"));
    expect(onMove).toHaveBeenLastCalledWith("g1", "f3");
    onMove.mockClear();
    fireEvent.pointerDown(sq("g1"));
    fireEvent.pointerUp(sq("g5"));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("AC-16: last move squares are marked", () => {
    render(
      <Harness
        game={game({ last_move: { from: "e2", to: "e4" }, ply: 1 })}
        seat="white"
        onMove={vi.fn()}
      />,
    );
    expect(marked("last move")).toEqual(["e2", "e4"]);
  });

  it("AC-17: the check mark follows check_square", () => {
    const { rerender } = render(
      <Harness game={game({ check_square: "e1" })} seat="white" onMove={vi.fn()} />,
    );
    expect(marked("in check")).toEqual(["e1"]);
    rerender(<Harness game={game()} seat="white" onMove={vi.fn()} />);
    expect(marked("in check")).toEqual([]);
  });

  it("AC-18: orientation puts the right rank at the bottom", () => {
    const bottomRow = (bottom: Color) => {
      render(<Harness game={game()} seat="viewer" bottom={bottom} onMove={vi.fn()} />);
      const cells = screen
        .getAllByRole("gridcell")
        .map((b) => b.getAttribute("aria-label")?.slice(0, 2));
      cleanup();
      return cells;
    };
    const w = bottomRow("white");
    expect(w[0]).toBe("a8");
    expect(w[63]).toBe("h1");
    const b = bottomRow("black");
    expect(b[0]).toBe("h1");
    expect(b[63]).toBe("a8");
  });

  it("AC-31: accessible names and live region", () => {
    render(
      <Harness
        game={game({ moves: [{ san: "e4", from: "e2", to: "e4" }], ply: 1, turn: "black" })}
        seat="viewer"
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByRole("gridcell", { name: "e4, empty" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "e2, white pawn" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("White: e4");
  });

  it("AC-31: result is announced", () => {
    render(
      <Harness
        game={game({ status: "ended", result: "white", reason: "checkmate" })}
        seat="viewer"
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("White wins");
  });

  it("AC-31: keyboard only select, navigate, confirm, escape", () => {
    const onMove = vi.fn();
    render(<Harness game={game()} seat="white" onMove={onMove} />);
    sq("e2").focus();
    key("Enter");
    expect(marked("legal move")).toEqual(["e3", "e4"]);
    key("ArrowUp");
    key("ArrowUp");
    expect(document.activeElement).toBe(sq("e4"));
    key("Escape");
    expect(marked("legal move")).toEqual([]);
    sq("e2").focus();
    key(" ");
    key("ArrowUp");
    key("ArrowUp");
    key("Enter");
    expect(onMove).toHaveBeenCalledWith("e2", "e4");
  });

  it("roving tabindex: exactly one square is tabbable", () => {
    render(<Harness game={game()} seat="white" onMove={vi.fn()} />);
    expect(screen.getAllByRole("gridcell").filter((b) => b.tabIndex === 0)).toHaveLength(1);
  });
});
