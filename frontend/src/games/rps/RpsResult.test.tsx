import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { RpsClosedSheet, RpsResultBanner, rpsResultText } from "./RpsResult";
import type { Reason, Recipient, Result } from "./rpsTypes";

afterEach(cleanup);

describe("rpsResultText (AC-20)", () => {
  it.each<[Result, Reason, Recipient, string]>([
    ["a", "flag", "a", "You won — you captured the flag"],
    ["a", "flag", "b", "You lost — your flag was captured"],
    ["a", "flag", "viewer", "Side A wins — flag captured"],
    ["b", "no_moves", "b", "You won — your opponent has no legal move"],
    ["b", "no_moves", "a", "You lost — you have no legal move"],
    ["b", "no_moves", "viewer", "Side B wins — no legal move"],
    ["a", "resignation", "a", "You won — your opponent resigned"],
    ["a", "resignation", "b", "You lost — you resigned"],
    ["a", "resignation", "viewer", "Side A wins — resignation"],
    ["draw", "agreement", "a", "Draw — agreed"],
    ["draw", "agreement", "b", "Draw — agreed"],
    ["draw", "agreement", "viewer", "Draw — agreed"],
    ["b", "abandonment", "b", "You won — by claim, your opponent was away"],
    ["b", "abandonment", "a", "You lost — your opponent claimed the win while you were away"],
    ["b", "abandonment", "viewer", "Side B wins — by claim"],
  ])("%s by %s, read by %s", (result, reason, you, text) => {
    expect(rpsResultText(result, reason, you)).toBe(text);
  });
});

describe("RpsResultBanner", () => {
  it("AC-20 announces the ending as a status", () => {
    render(<RpsResultBanner result="a" reason="flag" you="viewer" />);
    expect(screen.getByRole("status").textContent).toBe("Side A wins — flag captured");
  });

  it("NFR-5 renders as plain text inside a parent live region when live is false", () => {
    render(<RpsResultBanner result="a" reason="flag" you="viewer" live={false} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Side A wins — flag captured")).toBeTruthy();
  });
});

describe("RpsClosedSheet", () => {
  it("shows the result from the reader's side and a link back to Games", () => {
    render(
      <MemoryRouter>
        <RpsClosedSheet closed={{ result: "b", reason: "resignation" }} you="b" />
      </MemoryRouter>,
    );
    expect(screen.getByText("You won — your opponent resigned")).toBeTruthy();
    expect(screen.getByText(/session is closed/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /games/i }).getAttribute("href")).toBe("/games");
  });

  it("deleted by starter or admin says it was deleted", () => {
    for (const reason of ["starter", "admin"] as const) {
      render(
        <MemoryRouter>
          <RpsClosedSheet closed={{ result: null, reason }} you="viewer" />
        </MemoryRouter>,
      );
      expect(screen.getByText(/was deleted/i)).toBeTruthy();
      cleanup();
    }
  });
});
