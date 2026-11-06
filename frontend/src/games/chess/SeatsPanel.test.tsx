import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Game, Snapshot } from "./chessTypes";
import { SeatsPanel } from "./SeatsPanel";

afterEach(cleanup);

const seat = (id: string, name: string, away = false, signed_in = false) => ({
  participant_id: id,
  name,
  signed_in,
  away,
});

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    invite_id: "i",
    stale: false,
    seats: { white: null, black: null },
    viewers: [],
    game: null,
    ...over,
  };
}

const GAME = { status: "in_progress" } as Game;

function setup(snapshot: Snapshot, youId: string) {
  const send = vi.fn();
  render(<SeatsPanel snapshot={snapshot} youId={youId} send={send} />);
  return send;
}

describe("SeatsPanel", () => {
  it("AC-8 shows both players with colours and viewers", () => {
    setup(
      snap({
        seats: { white: seat("a", "Ann", false, true), black: seat("b", "Bob") },
        viewers: [
          { participant_id: "c", name: "Cy", signed_in: false },
          { participant_id: "d", name: "Di", signed_in: false },
        ],
      }),
      "c",
    );
    expect(screen.getByText("White").parentElement?.textContent).toContain("Ann");
    expect(screen.getByText("Black").parentElement?.textContent).toContain("Bob");
    expect(screen.getByText("Cy")).toBeTruthy();
    expect(screen.getByText("Di")).toBeTruthy();
    expect(screen.getByLabelText("signed in")).toBeTruthy();
  });

  it("AC-6 viewer takes the free Black seat", () => {
    const send = setup(snap({ seats: { white: seat("a", "Ann"), black: null } }), "v");
    expect(screen.getByText("free")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take seat" }));
    expect(send).toHaveBeenCalledWith({ type: "take_seat", color: "black" });
  });

  it("AC-6 White's player can leave", () => {
    const send = setup(snap({ seats: { white: seat("a", "Ann"), black: seat("b", "Bob") } }), "a");
    expect(screen.queryByRole("button", { name: /Switch/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave seat" }));
    expect(send).toHaveBeenCalledWith({ type: "leave_seat" });
  });

  it("AC-6 Black's player switches to free White", () => {
    const send = setup(snap({ seats: { white: null, black: seat("b", "Bob") } }), "b");
    fireEvent.click(screen.getByRole("button", { name: "Switch to White" }));
    expect(send).toHaveBeenCalledWith({ type: "take_seat", color: "white" });
  });

  it("AC-7 no seat buttons during a game", () => {
    setup(snap({ seats: { white: seat("a", "Ann"), black: null }, game: GAME }), "a");
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    setup(snap({ seats: { white: seat("a", "Ann"), black: null }, game: GAME }), "v");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("AC-25 shows the away mark", () => {
    setup(snap({ seats: { white: seat("a", "Ann"), black: seat("b", "Bob", true) } }), "a");
    expect(screen.getAllByText("away")).toHaveLength(1);
  });
});
