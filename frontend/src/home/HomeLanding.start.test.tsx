import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HomeSnapshot } from "../api/types";
import { HomeLanding } from "./HomeLanding";

// Spec 017 FR-12 (2026-11-19): `/` is always the home screen, never the problem library.

const state = vi.hoisted(() => ({
  signedIn: false,
  token: null as string | null,
  snapshot: null as unknown,
  error: null as unknown,
  feedCalls: 0,
}));

vi.mock("../auth/useMe", () => ({
  useMe: () => ({ status: "ready", me: { signed_in: state.signedIn } }),
}));
vi.mock("./rejoinToken", () => ({ findRejoinToken: () => state.token }));
vi.mock("./useHomeFeed", () => ({
  useHomeFeed: () => {
    state.feedCalls += 1;
    return { snapshot: state.snapshot, loading: false, error: state.error, refresh: () => {} };
  },
}));
vi.mock("../pages/ProblemsWindow", () => ({ ProblemsWindow: () => <p>problem library</p> }));
vi.mock("../ui/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("../ui/Window", () => ({ Window: ({ children }: { children: ReactNode }) => children }));

afterEach(() => {
  cleanup();
  Object.assign(state, { signedIn: false, token: null, snapshot: null, error: null, feedCalls: 0 });
});

function open() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<HomeLanding />} />
      </Routes>
    </MemoryRouter>,
  );
}

const tiles = () => document.querySelectorAll("[data-tile]");

describe("HomeLanding always shows the home screen (spec 017 FR-12)", () => {
  it("a visitor with no account and no joined session gets the home screen, not the library", () => {
    open();
    expect(screen.queryByText("problem library")).toBeNull();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toMatch(/^Good (morning|afternoon|evening)$/);
    expect(screen.getByRole("button", { name: "Start session" })).toBeTruthy();
    expect(tiles()).toHaveLength(1);
  });

  it("asks the server for nothing when there is no one to ask about", () => {
    open();
    expect(state.feedCalls).toBe(0);
  });

  it("a signed-in user whose feed fails gets the home screen with a notice", () => {
    state.signedIn = true;
    state.error = new Error("boom");
    open();
    expect(screen.queryByText("problem library")).toBeNull();
    expect(screen.getByRole("button", { name: "Start session" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/couldn.t be loaded/i);
  });

  it("a signed-in user with a feed still gets their own greeting and tiles", () => {
    state.signedIn = true;
    state.snapshot = {
      user: { first_name: "Mo", display_name: null, username: "mo" },
      live_participant_count: 1,
      sessions: [],
      idle_total: 0,
      games: [],
    } satisfies HomeSnapshot;
    open();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/, Mo$/);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
