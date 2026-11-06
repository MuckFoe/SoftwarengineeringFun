import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { MoveRecord } from "./chessTypes";
import { MoveList } from "./MoveList";
import { ClosedSheet, ResultBanner } from "./ResultBanner";

afterEach(cleanup);

const mv = (san: string): MoveRecord => ({ san, from: "a1", to: "a2" });

describe("MoveList", () => {
  it("AC-16: shows 1. e4 after the first move, black's reply on the same line", () => {
    const { rerender } = render(<MoveList moves={[mv("e4")]} />);
    expect(screen.getByText("1. e4")).toBeTruthy();
    rerender(<MoveList moves={[mv("e4"), mv("e5"), mv("Nf3")]} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]?.textContent).toBe("1. e4 e5");
    expect(items[1]?.textContent).toBe("2. Nf3");
  });
});

describe("ResultBanner", () => {
  it.each([
    ["white", "checkmate", "White wins — checkmate"],
    ["black", "resignation", "Black wins — resignation"],
    ["draw", "agreement", "Draw — agreement"],
    ["draw", "stalemate", "Draw — stalemate"],
    ["draw", "insufficient_material", "Draw — insufficient material"],
    ["draw", "threefold_repetition", "Draw — threefold repetition"],
    ["draw", "fifty_moves", "Draw — fifty-move rule"],
    ["white", "abandonment", "White wins — abandonment"],
  ] as const)("AC-20/21: %s %s", (result, reason, text) => {
    render(<ResultBanner result={result} reason={reason} />);
    expect(screen.getByText(text)).toBeTruthy();
  });
});

describe("ClosedSheet", () => {
  it("AC-22: shows the result and that the session is closed, with a link to Games", () => {
    render(
      <MemoryRouter>
        <ClosedSheet closed={{ result: "white", reason: "resignation" }} />
      </MemoryRouter>,
    );
    expect(screen.getByText("White wins — resignation")).toBeTruthy();
    expect(screen.getByText(/session is closed/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /games/i }).getAttribute("href")).toBe("/games");
  });
  it("AC-35: deleted by starter or admin says it was deleted", () => {
    for (const reason of ["starter", "admin"] as const) {
      render(
        <MemoryRouter>
          <ClosedSheet closed={{ result: null, reason }} />
        </MemoryRouter>,
      );
      expect(screen.getByText(/was deleted/i)).toBeTruthy();
      cleanup();
    }
  });
});
