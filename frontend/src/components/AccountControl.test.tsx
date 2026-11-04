import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../api/types";
import { LearningSessionWindow } from "../learn/LearningSessionWindow";
import { LearnWindow } from "../learn/LearnWindow";
import { NotFound } from "../pages/NotFound";
import { ProblemsWindow } from "../pages/ProblemsWindow";
import { SessionWindow } from "../pages/SessionWindow";
import { PresentSessionWindow } from "../present/PresentSessionWindow";
import { PresentWindow } from "../present/PresentWindow";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { AccountControl } from "./AccountControl";

// BASE is fixed when base.ts loads, so the base path is mocked; every importer of base.ts,
// the API client included, sees the value a test sets (spec 005 FR1).
const mockedBase = vi.hoisted(() => ({ value: "/" }));
vi.mock("../base", () => ({
  get BASE() {
    return mockedBase.value;
  },
  apiPath: (p: string) => `${mockedBase.value}api${p}`,
}));

const SIGNED_OUT: Me = { signed_in: false, roles: [] };
const EDITOR: Me = { signed_in: true, name: "newuser", roles: ["editor"], preferences: null };

// The backend is not part of this unit; only the HTTP boundary is stubbed. Everything but
// /api/me stays pending, so each window shows its own first (loading) toolbar.
function stubServer(me: Me) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === `${mockedBase.value}api/me`)
        return new Response(JSON.stringify(me), { status: 200 });
      return new Promise<Response>(() => {});
    }),
  );
}

function renderAt(path: string, element: ReactNode = <AccountControl />, route = "*") {
  render(
    <ShortcutsProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </MemoryRouter>
    </ShortcutsProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mockedBase.value = "/";
});

describe("AccountControl", () => {
  it("signed out: a Profile entry to the profile, coming from this path", async () => {
    stubServer(SIGNED_OUT);
    renderAt("/s/abc");
    const link = await screen.findByRole("link", { name: "Profile" });
    expect(link.getAttribute("href")).toBe("/profile?from=%2Fs%2Fabc");
  });

  it("keeps the query string in from", async () => {
    stubServer(SIGNED_OUT);
    renderAt("/?q=rev");
    const link = await screen.findByRole("link", { name: "Profile" });
    expect(link.getAttribute("href")).toBe("/profile?from=%2F%3Fq%3Drev");
  });

  it("signed in: the entry is the username, and no sign-in link or popover", async () => {
    stubServer(EDITOR);
    renderAt("/learn");
    const link = await screen.findByRole("link", { name: "newuser" });
    expect(link.getAttribute("href")).toBe("/profile?from=%2Flearn");
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out", hidden: true })).toBeNull();
  });

  it("is there before /api/me answers", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderAt("/present");
    expect(screen.getByRole("link", { name: "Profile" }).getAttribute("href")).toBe(
      "/profile?from=%2Fpresent",
    );
  });

  it("under a base path, from stays router-relative and the link carries the base once", async () => {
    mockedBase.value = "/collab/";
    stubServer(SIGNED_OUT);
    render(
      <MemoryRouter basename="/collab" initialEntries={["/collab/s/abc"]}>
        <AccountControl />
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", { name: "Profile" });
    expect(link.getAttribute("href")).toBe("/collab/profile?from=%2Fs%2Fabc");
  });
});

// FR-9: every screen, signed in or not, opens the profile from its toolbar.
const WINDOWS: { toolbar: string; path: string; route: string; element: ReactNode }[] = [
  { toolbar: "Problems", path: "/", route: "/", element: <ProblemsWindow /> },
  { toolbar: "Session", path: "/s/abc", route: "/s/:invite", element: <SessionWindow /> },
  { toolbar: "Learn", path: "/learn", route: "/learn", element: <LearnWindow /> },
  {
    toolbar: "Learning session",
    path: "/learn/s/abc",
    route: "/learn/s/:invite",
    element: <LearningSessionWindow />,
  },
  { toolbar: "Present", path: "/present", route: "/present", element: <PresentWindow /> },
  {
    toolbar: "Presentation session",
    path: "/present/s/abc",
    route: "/present/s/:invite",
    element: <PresentSessionWindow />,
  },
  { toolbar: "Window", path: "/nope", route: "*", element: <NotFound /> },
];

describe("FR-9: the profile entry on every screen", () => {
  for (const [who, me, name] of [
    ["signed out", SIGNED_OUT, "Profile"],
    ["signed in", EDITOR, "newuser"],
  ] as const) {
    for (const w of WINDOWS) {
      it(`${w.toolbar}, ${who}`, async () => {
        stubServer(me);
        renderAt(w.path, w.element, w.route);
        const toolbar = await screen.findByRole("toolbar", { name: w.toolbar });
        const link = await within(toolbar).findByRole("link", { name });
        expect(link.getAttribute("href")).toBe(`/profile?from=${encodeURIComponent(w.path)}`);
      });
    }
  }
});
