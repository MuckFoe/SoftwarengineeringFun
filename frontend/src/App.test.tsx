import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubServer(roles: string[] = ["editor"]) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/me") {
      return json(200, { signed_in: true, name: "user1", roles });
    }
    if (url.pathname === "/api/problems") return json(200, []);
    if (url.pathname === "/api/problems/abc/edit") {
      return json(200, {
        id: "abc",
        title: "Existing problem",
        description: "d",
        signature: "def f() -> int",
        tests: [],
      });
    }
    if (url.pathname === "/api/sessions/abc") return json(404, { error: "not_found" });
    return json(404, { error: "not_found" });
  });
  vi.stubGlobal("fetch", fn);
}

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-appearance");
});

/** A stand-in OS colour scheme: `prefers-color-scheme: dark` that tests can flip. */
function stubOsScheme(dark: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const media = {
    get matches() {
      return dark;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
  };
  vi.stubGlobal("matchMedia", () => media);
  return (next: boolean) => {
    dark = next;
    act(() => {
      for (const l of listeners) l({ matches: next } as MediaQueryListEvent);
    });
  };
}

const appearance = () => document.documentElement.getAttribute("data-appearance");

describe("App routing", () => {
  it("/ renders ProblemsWindow with no sheet open", async () => {
    stubServer();
    renderRoute("/");

    expect(await screen.findByRole("toolbar", { name: "Problems" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search problems" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("/problems/new opens ProblemsWindow with the new-problem sheet open (FR-8)", async () => {
    stubServer();
    renderRoute("/problems/new");

    const dialog = await screen.findByRole("dialog", { name: "New problem" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getByRole("toolbar", { name: "Problems", hidden: true })).toBeTruthy();
  });

  it("/problems/:id/edit opens ProblemsWindow with that problem's edit sheet open (FR-8)", async () => {
    stubServer();
    renderRoute("/problems/abc/edit");

    const dialog = await screen.findByRole("dialog", { name: "Edit problem" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(await screen.findByDisplayValue("Existing problem")).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Problems", hidden: true })).toBeTruthy();
  });

  it("the deep links still need the editor role (spec 001 FR-2a)", async () => {
    for (const path of ["/problems/new", "/problems/abc/edit"]) {
      stubServer([]);
      renderRoute(path);

      expect(await screen.findByRole("heading", { name: "You can't do this" })).toBeTruthy();
      expect(screen.queryByRole("dialog")).toBeNull();
      cleanup();
    }
  });

  it("/s/:invite renders SessionWindow", async () => {
    stubServer();
    renderRoute("/s/abc");

    expect(await screen.findByText("Session not found")).toBeTruthy();
  });

  it("an unknown path renders NotFound", async () => {
    stubServer();
    renderRoute("/nope");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
  });
});

describe("App shell (spec 003)", () => {
  it("FR-19: the shortcut-list combo opens the list on any screen", async () => {
    stubServer();
    renderRoute("/");
    await screen.findByRole("toolbar", { name: "Problems" });
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();

    fireEvent.keyDown(window, { key: "?", code: "Slash", ctrlKey: true, shiftKey: true });

    const list = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(list.textContent).toContain("Run code");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });

  it("FR-5: with no stored choice the app follows the OS, live", async () => {
    stubServer();
    const setOs = stubOsScheme(true);
    renderRoute("/nope");
    await screen.findByRole("heading", { name: "Page not found" });
    expect(appearance()).toBe("dark");

    setOs(false);
    expect(appearance()).toBe("light");
  });

  it("FR-6: a Light choice holds when the OS changes, on every screen at once", async () => {
    stubServer();
    const setOs = stubOsScheme(true);
    renderRoute("/");
    await screen.findByRole("toolbar", { name: "Problems" });

    fireEvent.click(screen.getByRole("radio", { name: "Light", hidden: true }));
    expect(appearance()).toBe("light");
    setOs(false);
    setOs(true);
    expect(appearance()).toBe("light");

    fireEvent.click(screen.getByRole("radio", { name: "System", hidden: true }));
    expect(appearance()).toBe("dark");
  });
});
