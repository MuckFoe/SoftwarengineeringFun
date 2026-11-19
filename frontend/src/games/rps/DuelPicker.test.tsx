import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DuelPicker } from "./DuelPicker";
import { BODY, KIND_PARTS } from "./pieces/figureParts";
import type { RpsDuel } from "./rpsTypes";

afterEach(cleanup);

function duel(over: Partial<RpsDuel> = {}): RpsDuel {
  return {
    from: 8,
    to: 15,
    attacker: "a",
    round: 1,
    picked: { a: false, b: false },
    your_pick: null,
    last_round: null,
    ...over,
  };
}

const WEAPONS = ["Rock", "Paper", "Scissors"];

function glyphPaths(button: HTMLElement): string[] {
  return Array.from(button.querySelectorAll("svg path:not([data-layer])")).map(
    (p) => p.getAttribute("d") ?? "",
  );
}

describe("DuelPicker", () => {
  it("AC-13: a player who has not picked gets three enabled weapon buttons", () => {
    const onPick = vi.fn();
    render(<DuelPicker duel={duel()} you="a" onPick={onPick} />);
    for (const name of WEAPONS) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
    }
    fireEvent.click(screen.getByRole("button", { name: "Paper" }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith("paper");
  });

  it("AC-13: after the player's pick the buttons are disabled and it waits", () => {
    const onPick = vi.fn();
    render(
      <DuelPicker
        duel={duel({ your_pick: "rock", picked: { a: true, b: false } })}
        you="a"
        onPick={onPick}
      />,
    );
    for (const name of WEAPONS) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText(/you picked rock/i)).toBeTruthy();
    expect(screen.getByText(/waiting for your opponent/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scissors" }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("AC-13: a tied last round is shown and the new round can be picked", () => {
    render(
      <DuelPicker
        duel={duel({ round: 2, last_round: { a: "scissors", b: "scissors" } })}
        you="b"
        onPick={() => {}}
      />,
    );
    expect(screen.getByText(/tie: you both picked scissors/i)).toBeTruthy();
    for (const name of WEAPONS) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it("FR-21: a viewer gets no buttons, only who has picked and the last round", () => {
    render(
      <DuelPicker
        duel={duel({
          round: 2,
          picked: { a: true, b: false },
          last_round: { a: "paper", b: "paper" },
        })}
        you="viewer"
        onPick={() => {}}
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Side A has picked")).toBeTruthy();
    expect(screen.getByText("Side B is picking")).toBeTruthy();
    expect(screen.getByText(/side a picked paper, side b picked paper/i)).toBeTruthy();
  });

  it("NFR-5: focus lands on the first button when the duel appears and on each new round", () => {
    const { rerender } = render(<DuelPicker duel={duel()} you="a" onPick={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rock" }));
    rerender(
      <DuelPicker
        duel={duel({ your_pick: "paper", picked: { a: true, b: false } })}
        you="a"
        onPick={() => {}}
      />,
    );
    (document.activeElement as HTMLElement | null)?.blur();
    rerender(
      <DuelPicker
        duel={duel({ round: 2, last_round: { a: "paper", b: "paper" } })}
        you="a"
        onPick={() => {}}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rock" }));
  });

  it("NFR-5: arrow keys move focus between the weapons", () => {
    render(<DuelPicker duel={duel()} you="a" onPick={() => {}} />);
    const key = (k: string) => fireEvent.keyDown(document.activeElement as Element, { key: k });
    key("ArrowRight");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Paper" }));
    key("ArrowLeft");
    key("ArrowLeft");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Scissors" }));
  });

  it("AC-28: each button shows exactly its own weapon's parts, no body, hidden from AT", () => {
    for (const you of ["a", "b"] as const) {
      render(<DuelPicker duel={duel()} you={you} onPick={() => {}} />);
      for (const [weapon, name] of [
        ["rock", "Rock"],
        ["paper", "Paper"],
        ["scissors", "Scissors"],
      ] as const) {
        const button = screen.getByRole("button", { name });
        const svgs = button.querySelectorAll("svg");
        expect(svgs).toHaveLength(1);
        expect(svgs[0]?.getAttribute("aria-hidden")).toBe("true");
        expect(svgs[0]?.getAttribute("data-side")).toBe(you);
        expect(glyphPaths(button)).toEqual(KIND_PARTS[weapon].map((p) => p.d));
        for (const part of BODY) expect(glyphPaths(button)).not.toContain(part.d);
      }
      cleanup();
    }
  });
});
