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
  it("links to Problems and Learn", () => {
    const nav = renderAt("/");
    expect(within(nav).getByRole("link", { name: "Problems" }).getAttribute("href")).toBe("/");
    expect(within(nav).getByRole("link", { name: "Learn" }).getAttribute("href")).toBe("/learn");
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
    const sidebar = screen.getByRole("navigation", { name: "Sidebar" });
    const learn = await within(sidebar).findByRole("link", { name: "Learn" });
    expect(learn.getAttribute("href")).toBe("/learn");
  });
});
