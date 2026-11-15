import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Recipient, RpsClientMessage, RpsGame } from "./rpsTypes";
import { homeSquares, type Placing, SetupBar, setupPlaceFrame } from "./SetupBar";

afterEach(cleanup);

function game(over: Partial<RpsGame> = {}): RpsGame {
  return {
    status: "setup",
    ready: { a: false, b: false },
    first: "a",
    turn: null,
    ply: 0,
    pieces: [],
    legal: {},
    duel: null,
    draw_offer_by: null,
    claim_available_to: null,
    result: null,
    reason: null,
    ...over,
  };
}

/** The session window's wiring: the bar owns the choice, a home square's Enter places it. */
function Harness({
  g,
  you,
  send,
  square,
}: {
  g: RpsGame;
  you: Recipient;
  send: (m: RpsClientMessage) => void;
  square: number;
}) {
  const [placing, setPlacing] = useState<Placing>("flag");
  return (
    <>
      <SetupBar game={g} you={you} placing={placing} onPlacingChange={setPlacing} send={send} />
      <button
        type="button"
        onClick={() => {
          const frame = setupPlaceFrame(g, you, placing, square);
          if (frame) send(frame);
        }}
      >
        Home square
      </button>
    </>
  );
}

describe("SetupBar", () => {
  it("home squares are the two home rows of each side", () => {
    expect(homeSquares("a")).toEqual([...Array(14).keys()]);
    expect(homeSquares("b")).toEqual([...Array(14).keys()].map((i) => i + 28));
  });

  it("AC-4/AC-5: choosing trap then activating a home square emits place trap", () => {
    const send = vi.fn();
    render(<Harness g={game()} you="a" send={send} square={9} />);
    fireEvent.click(screen.getByRole("radio", { name: "Trap" }));
    fireEvent.click(screen.getByRole("button", { name: "Home square" }));
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "place", what: "trap", square: 9 });
  });

  it("AC-4: flag is chosen by default", () => {
    const send = vi.fn();
    render(<Harness g={game()} you="b" send={send} square={30} />);
    expect(screen.getByRole("radio", { name: "Flag" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Home square" }));
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "place", what: "flag", square: 30 });
  });

  it("AC-4: a square outside your home rows places nothing", () => {
    expect(setupPlaceFrame(game(), "a", "flag", 20)).toBeNull();
    expect(setupPlaceFrame(game(), "b", "trap", 3)).toBeNull();
    expect(setupPlaceFrame(game(), "viewer", "flag", 3)).toBeNull();
    expect(setupPlaceFrame(game({ status: "play" }), "a", "flag", 3)).toBeNull();
  });

  it("AC-5: Re-deal emits redeal", () => {
    const send = vi.fn();
    render(<Harness g={game()} you="a" send={send} square={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Re-deal" }));
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "redeal" });
  });

  it("AC-6: Ready emits ready once; after ready every control is disabled", () => {
    const send = vi.fn();
    const { rerender } = render(<Harness g={game()} you="a" send={send} square={4} />);
    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "ready" });

    rerender(<Harness g={game({ ready: { a: true, b: false } })} you="a" send={send} square={4} />);
    for (const control of [
      screen.getByRole("radio", { name: "Flag" }),
      screen.getByRole("radio", { name: "Trap" }),
      screen.getByRole("button", { name: "Re-deal" }),
      screen.getByRole("button", { name: /ready/i }),
    ]) {
      expect(control.matches(":disabled")).toBe(true);
    }
    fireEvent.click(screen.getByRole("radio", { name: "Trap" }));
    fireEvent.click(screen.getByRole("button", { name: "Re-deal" }));
    fireEvent.click(screen.getByRole("button", { name: /ready/i }));
    fireEvent.click(screen.getByRole("button", { name: "Home square" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/you are ready/i)).toBeTruthy();
  });

  it("FR-6: shows whether the opponent is ready", () => {
    const { rerender } = render(
      <SetupBar game={game()} you="a" placing="flag" onPlacingChange={() => {}} send={() => {}} />,
    );
    expect(screen.getByText(/opponent is still setting up/i)).toBeTruthy();
    rerender(
      <SetupBar
        game={game({ ready: { a: false, b: true } })}
        you="a"
        placing="flag"
        onPlacingChange={() => {}}
        send={() => {}}
      />,
    );
    expect(screen.getByText(/opponent is ready/i)).toBeTruthy();
  });

  it("FR-21: a viewer sees both sides' ready state and no controls", () => {
    render(
      <SetupBar
        game={game({ ready: { a: true, b: false } })}
        you="viewer"
        placing="flag"
        onPlacingChange={() => {}}
        send={() => {}}
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText("Side A is ready")).toBeTruthy();
    expect(screen.getByText("Side B is setting up")).toBeTruthy();
  });
});
