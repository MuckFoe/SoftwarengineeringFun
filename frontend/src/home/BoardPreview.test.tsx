import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BoardPreview } from "./BoardPreview";

afterEach(cleanup);
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function sq(c: HTMLElement, s: string) {
  return c.querySelector(`[data-square="${s}"]`) as HTMLElement;
}

describe("BoardPreview", () => {
  it("FR-6: start position, aria-hidden, not focusable", () => {
    const { container } = render(<BoardPreview fen={START} />);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelectorAll("[data-square]").length).toBe(64);
    expect(root.querySelector("button, a, [tabindex]")).toBeNull();
    expect(sq(root, "e1").getAttribute("data-piece")).toBe("wK");
    expect(sq(root, "d8").getAttribute("data-piece")).toBe("bQ");
    expect(sq(root, "e4").getAttribute("data-piece")).toBeNull();
    expect(root.querySelectorAll("img").length).toBe(32);
  });
  it("FR-6: mid-game FEN puts pieces on the right squares", () => {
    const { container } = render(
      <BoardPreview fen="r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3" />,
    );
    const root = container.firstChild as HTMLElement;
    expect(sq(root, "f3").getAttribute("data-piece")).toBe("wN");
    expect(sq(root, "e5").getAttribute("data-piece")).toBe("bP");
    expect(sq(root, "c6").getAttribute("data-piece")).toBe("bN");
    expect(sq(root, "g1").getAttribute("data-piece")).toBeNull();
  });
});
