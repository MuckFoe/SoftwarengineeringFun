import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProblemsWindow } from "../pages/ProblemsWindow";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { AreaNav } from "./AreaNav";

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AreaNav />
    </MemoryRouter>,
  );
  return screen.getByRole("region", { name: "Areas" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AreaNav (FR-1)", () => {
  // AC-1 (component part)
  it("links to Problems, Learn and Present", () => {
    const nav = renderAt("/");
    expect(within(nav).getByRole("link", { name: "Problems" }).getAttribute("href")).toBe("/");
    expect(within(nav).getByRole("link", { name: "Learn" }).getAttribute("href")).toBe("/learn");
    expect(within(nav).getByRole("link", { name: "Present" }).getAttribute("href")).toBe(
      "/present",
    );
  });

  // Spec 014 AC-1: Games is in the main navigation.
  it("links to Games at /games and marks it current under /games", () => {
    const nav = renderAt("/games/chess/s/x");
    const games = within(nav).getByRole("link", { name: "Games" });
    expect(games.getAttribute("href")).toBe("/games");
    expect(games.getAttribute("aria-current")).toBe("page");
    expect(
      within(nav).getByRole("link", { name: "Problems" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  // Spec 013: the Present area is current anywhere under /present.
  it.each(["/present", "/present/s/x"])("marks Present current at %s", (path) => {
    renderAt(path);
    expect(screen.getByRole("link", { name: "Present" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Problems" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Learn" }).getAttribute("aria-current")).toBeNull();
  });

  it("does not mark Present current on a path that only starts with the word", () => {
    renderAt("/presentation");
    expect(screen.getByRole("link", { name: "Present" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks Problems current on the problems window", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "Problems" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Learn" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks Learn current anywhere under /learn", () => {
    renderAt("/learn/s/abc");
    expect(screen.getByRole("link", { name: "Learn" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Problems" }).getAttribute("aria-current")).toBeNull();
  });
});

describe("ProblemsWindow's sidebar", () => {
  // AC-1: the main navigation has a Learn entry.
  it("has the Learn entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/me"
          ? new Response(JSON.stringify({ signed_in: false, roles: [] }), { status: 200 })
          : new Response("[]", { status: 200 }),
      ),
    );
    render(
      <ShortcutsProvider>
        <MemoryRouter initialEntries={["/"]}>
          <ProblemsWindow />
        </MemoryRouter>
      </ShortcutsProvider>,
    );
    expect(await screen.findByRole("tab", { name: "Learn" })).toBeTruthy();
  });
});
