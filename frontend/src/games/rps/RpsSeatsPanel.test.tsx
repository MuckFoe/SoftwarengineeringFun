import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpsSeatsPanel } from "./RpsSeatsPanel";
import type { RpsGame, RpsState } from "./rpsTypes";

afterEach(cleanup);

const seat = (id: string, name: string, away = false, signed_in = false) => ({
  participant_id: id,
  name,
  signed_in,
  away,
});

function st(over: Partial<RpsState> = {}): RpsState {
  return {
    invite_id: "i",
    stale: false,
    seats: { a: null, b: null },
    viewers: [],
    you: "viewer",
    game: null,
    ...over,
  };
}

const game = (status: RpsGame["status"]) => ({ status }) as RpsGame;

function setup(state: RpsState) {
  const send = vi.fn();
  render(<RpsSeatsPanel state={state} send={send} />);
  return send;
}

describe("RpsSeatsPanel", () => {
  it("AC-2 shows both players by side, and the viewers", () => {
    setup(
      st({
        seats: { a: seat("a", "Ann", false, true), b: seat("b", "Bob") },
        viewers: [{ participant_id: "c", name: "Cy", signed_in: false }],
      }),
    );
    expect(screen.getByText("Side A").parentElement?.textContent).toContain("Ann");
    expect(screen.getByText("Side B").parentElement?.textContent).toContain("Bob");
    expect(screen.getByText("Cy")).toBeTruthy();
    expect(screen.getByLabelText("signed in")).toBeTruthy();
  });

  it("AC-2 a viewer gets no take-seat while both seats are full", () => {
    setup(st({ seats: { a: seat("a", "Ann"), b: seat("b", "Bob") } }));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("AC-2 a viewer takes the seat a player left", () => {
    const send = setup(st({ seats: { a: seat("a", "Ann"), b: null } }));
    expect(screen.getByText("free")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take seat" }));
    expect(send).toHaveBeenCalledWith({ type: "take_seat", side: "b" });
  });

  it("AC-2 both seats free: one take-seat per side", () => {
    const send = setup(st());
    fireEvent.click(screen.getByRole("button", { name: "Take seat (Side A)" }));
    expect(send).toHaveBeenCalledWith({ type: "take_seat", side: "a" });
    expect(screen.getByRole("button", { name: "Take seat (Side B)" })).toBeTruthy();
  });

  it("AC-2 a player leaves before the game, and may switch to a free side", () => {
    const send = setup(st({ seats: { a: null, b: seat("b", "Bob") }, you: "b" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave seat" }));
    expect(send).toHaveBeenCalledWith({ type: "leave_seat" });
    fireEvent.click(screen.getByRole("button", { name: "Switch to Side A" }));
    expect(send).toHaveBeenCalledWith({ type: "take_seat", side: "a" });
  });

  it("AC-2 a seated player with a full board only gets leave-seat", () => {
    setup(st({ seats: { a: seat("a", "Ann"), b: seat("b", "Bob") }, you: "a" }));
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Leave seat"]);
  });

  it.each(["setup", "play"] as const)("AC-2 no seat buttons once a game is in %s", (status) => {
    setup(st({ seats: { a: seat("a", "Ann"), b: null }, you: "a", game: game(status) }));
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    setup(st({ seats: { a: seat("a", "Ann"), b: null }, game: game(status) }));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("AC-2 seats can change again after a game ended", () => {
    setup(
      st({ seats: { a: seat("a", "Ann"), b: seat("b", "Bob") }, you: "a", game: game("ended") }),
    );
    expect(screen.getByRole("button", { name: "Leave seat" })).toBeTruthy();
  });

  it("shows the away mark", () => {
    setup(st({ seats: { a: seat("a", "Ann"), b: seat("b", "Bob", true) } }));
    expect(screen.getAllByText("away")).toHaveLength(1);
  });
});
