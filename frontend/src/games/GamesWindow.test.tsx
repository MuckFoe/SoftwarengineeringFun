import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { GamesWindow } from "./GamesWindow";

const CATALOGUE = [
  {
    id: "chess",
    name: "Chess",
    description: "Play a friend on a shared board.",
    start_path: "/api/games/chess/sessions",
  },
];

function stubServer() {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === "/api/me") return json({ signed_in: false, roles: [] });
    if (path === "/api/games") return json(CATALOGUE);
    if (path === "/api/games/chess/sessions" && init?.method === "POST") {
      return json({ invite_id: "chess-inv1" }, 201);
    }
    return json({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function Where() {
  return <output aria-label="location">{useLocation().pathname}</output>;
}

function renderWindow() {
  render(
    <ShortcutsProvider>
      <MemoryRouter initialEntries={["/games"]}>
        <Routes>
          <Route path="/games" element={<GamesWindow />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ShortcutsProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GamesWindow", () => {
  // AC-1 (FR-1, FR-2)
  it("lists chess with its name and description", async () => {
    stubServer();
    renderWindow();
    expect(await screen.findByText("Chess")).toBeTruthy();
    expect(screen.getByText("Play a friend on a shared board.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Start/ })).toBeTruthy();
  });

  // AC-2 (FR-3): no sign-in needed
  it("Start creates a chess session and opens its invite route", async () => {
    const fn = stubServer();
    renderWindow();
    fireEvent.click(await screen.findByRole("button", { name: /Start/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("location").textContent).toBe("/games/chess/s/chess-inv1"),
    );
    const posted = fn.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posted).toHaveLength(1);
  });

  it("shows an error when the catalogue cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    renderWindow();
    expect(await screen.findByText("Could not load games.")).toBeTruthy();
  });
});
