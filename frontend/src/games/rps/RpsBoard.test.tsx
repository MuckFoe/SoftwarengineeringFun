import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PIECE_PATHS } from "./pieces/paths";
import { RpsBoard } from "./RpsBoard";
import type { Recipient, RpsGame, RpsPiece, Side } from "./rpsTypes";

// Spec 021 task 16: FR-9, FR-21, NFR-5 / AC-9, AC-27. Squares are `row * 7 + col`, row 0 on
// side a's edge; names count columns A–G and rows 1–6 from the reader's side.

const p = (square: number, side: Side, kind: RpsPiece["kind"]): RpsPiece => ({
  square,
  side,
  kind,
  revealed: false,
});

function game(over: Partial<RpsGame> = {}): RpsGame {
  return {
    status: "play",
    ready: { a: true, b: true },
    first: "a",
    turn: "a",
    ply: 0,
    // C2 = row 1, col 2 = 9; D5 = row 4, col 3 = 31 (from side a).
    pieces: [p(9, "a", "rock"), p(2, "a", "flag"), p(31, "b", null), p(35, "b", null)],
    legal: { 9: [16, 8, 10] },
    duel: null,
    draw_offer_by: null,
    claim_available_to: null,
    result: null,
    reason: null,
    ...over,
  };
}

function Harness(props: {
  game: RpsGame;
  you: Recipient;
  bottom?: Side;
  onMove?: (from: number, to: number) => void;
  onSetupSquare?: (square: number) => void;
}) {
  const [sel, setSel] = useState<number | null>(null);
  return (
    <RpsBoard
      game={props.game}
      you={props.you}
      bottom={props.bottom ?? (props.you === "b" ? "b" : "a")}
      selected={sel}
      onSelect={(s) => setSel((cur) => (s === cur ? null : s))}
      onMove={props.onMove ?? vi.fn()}
      onSetupSquare={props.onSetupSquare}
    />
  );
}

const cell = (name: string) => screen.getByRole("gridcell", { name: new RegExp(`, ${name}(,|$)`) });
const targets = () =>
  screen
    .queryAllByRole("gridcell")
    .filter((b) => (b.getAttribute("aria-label") ?? "").includes("legal target"))
    .map((b) => b.dataset.square)
    .sort();
const key = (k: string) => fireEvent.keyDown(document.activeElement as HTMLElement, { key: k });

afterEach(cleanup);

describe("RpsBoard", () => {
  it("is a 7×6 grid named Rock Paper Siege board", () => {
    render(<Harness game={game()} you="a" />);
    const grid = screen.getByRole("grid", { name: "Rock Paper Siege board" });
    expect(screen.getAllByRole("row")).toHaveLength(6);
    expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(42);
  });

  it("NFR-5 / AC-27: names each cell with side, kind or hidden, and position", () => {
    render(<Harness game={game()} you="a" />);
    expect(screen.getByRole("gridcell", { name: "Your rock, C2" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "Your flag, C1" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "Opponent hidden piece, D5" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "Empty, E3" })).toBeTruthy();
  });

  it("own side at the bottom: side b reads from its own corner", () => {
    render(<Harness game={game({ turn: "b", legal: {} })} you="b" />);
    // Square 9 (C2 from side a) is E5 from side b; square 31 (D5) is D2.
    expect(screen.getByRole("gridcell", { name: "Opponent rock, E5" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "Your hidden piece, D2" })).toBeTruthy();
    const cells = screen.getAllByRole("gridcell");
    expect(cells[0]?.getAttribute("aria-label")).toMatch(/, A6$/);
    expect(cells[41]?.getAttribute("aria-label")).toMatch(/, G1$/);
    expect(cells[0]?.dataset.square).toBe("6");
    expect(cells[41]?.dataset.square).toBe("35");
  });

  it("FR-21: viewers read from side a and see kinds by side", () => {
    const g = game({ pieces: [p(9, "a", "rock"), p(31, "b", "paper")], legal: {} });
    render(<Harness game={g} you="viewer" bottom="a" />);
    expect(screen.getByRole("gridcell", { name: "Side A rock, C2" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "Side B paper, D5" })).toBeTruthy();
    const cells = screen.getAllByRole("gridcell");
    expect(cells[0]?.getAttribute("aria-label")).toMatch(/, A6$/);
    expect(cells[41]?.dataset.square).toBe("6");
  });

  it("FR-21: a hidden kind draws the hidden artwork in the side's style", () => {
    render(<Harness game={game()} you="a" />);
    const hidden = cell("D5").querySelector("svg");
    expect(hidden?.getAttribute("role")).toBe("presentation");
    expect(hidden?.querySelector("path")?.getAttribute("d")).toBe(PIECE_PATHS.hidden);
    expect(hidden?.getAttribute("class")).toMatch(/sideB/);
    const rock = cell("C2").querySelector("svg");
    expect(rock?.querySelector("path")?.getAttribute("d")).toBe(PIECE_PATHS.rock);
    expect(rock?.getAttribute("class")).toMatch(/sideA/);
    expect(cell("E3").querySelector("svg")).toBeNull();
  });

  it("AC-9: selecting a fighter marks exactly legal[from]", () => {
    render(<Harness game={game()} you="a" />);
    fireEvent.click(cell("C2"));
    expect(targets()).toEqual(["10", "16", "8"]);
    expect(cell("C2").getAttribute("aria-label")).toContain("selected");
  });

  it("AC-9: Enter on a non-target sends nothing; Enter on a target emits move", () => {
    const onMove = vi.fn();
    render(<Harness game={game()} you="a" onMove={onMove} />);
    cell("C2").focus();
    key("Enter");
    key("ArrowRight");
    key("ArrowRight");
    expect(document.activeElement).toBe(cell("E2"));
    key("Enter");
    expect(onMove).not.toHaveBeenCalled();
    cell("C2").focus();
    key("Enter");
    key("ArrowUp");
    expect(document.activeElement).toBe(cell("C3"));
    key("Enter");
    expect(onMove).toHaveBeenCalledWith(9, 16);
  });

  it("AC-9: no selection when it is not your move, for viewers, or for immovable pieces", () => {
    const onMove = vi.fn();
    render(<Harness game={game({ turn: "b", legal: {} })} you="a" onMove={onMove} />);
    fireEvent.click(cell("C2"));
    expect(targets()).toEqual([]);
    cleanup();
    render(<Harness game={game()} you="viewer" onMove={onMove} />);
    fireEvent.click(cell("C2"));
    expect(targets()).toEqual([]);
    cleanup();
    render(<Harness game={game()} you="a" onMove={onMove} />);
    fireEvent.click(cell("C1"));
    expect(targets()).toEqual([]);
    cleanup();
    render(<Harness game={game({ status: "ended", result: "a", reason: "flag" })} you="a" />);
    fireEvent.click(cell("C2"));
    expect(targets()).toEqual([]);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("NFR-5: arrows move focus within bounds, Escape clears the selection", () => {
    render(<Harness game={game()} you="a" />);
    cell("A1").focus();
    key("ArrowLeft");
    key("ArrowDown");
    expect(document.activeElement).toBe(cell("A1"));
    for (let i = 0; i < 10; i++) key("ArrowUp");
    expect(document.activeElement).toBe(cell("A6"));
    for (let i = 0; i < 10; i++) key("ArrowRight");
    expect(document.activeElement).toBe(cell("G6"));
    cell("C2").focus();
    key(" ");
    expect(targets()).toHaveLength(3);
    key("Escape");
    expect(targets()).toEqual([]);
  });

  it("roving tabindex: exactly one cell is tabbable and it follows focus", () => {
    render(<Harness game={game()} you="a" />);
    const tabbable = () => screen.getAllByRole("gridcell").filter((b) => b.tabIndex === 0);
    expect(tabbable()).toHaveLength(1);
    act(() => cell("D4").focus());
    expect(tabbable()).toEqual([cell("D4")]);
  });

  it("setup: Enter on a square hands it to the setup handler and moves nothing", () => {
    const onSetupSquare = vi.fn();
    const onMove = vi.fn();
    render(
      <Harness
        game={game({ status: "setup", turn: null, legal: {} })}
        you="a"
        onMove={onMove}
        onSetupSquare={onSetupSquare}
      />,
    );
    cell("C2").focus();
    key("Enter");
    expect(onSetupSquare).toHaveBeenCalledWith(9);
    expect(onMove).not.toHaveBeenCalled();
  });
});
