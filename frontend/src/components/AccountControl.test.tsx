import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../api/types";
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

// The backend is not part of this unit; only the HTTP boundary is stubbed.
function stubServer(me: Me) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${mockedBase.value}api/me`)
      return new Response(JSON.stringify(me), { status: 200 });
    if (url === "/api/auth/logout" && init?.method === "POST")
      return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderAt(path: string, onSignedOut = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AccountControl onSignedOut={onSignedOut} />
    </MemoryRouter>,
  );
  return onSignedOut;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mockedBase.value = "/";
  document.documentElement.removeAttribute("data-appearance");
});

describe("AccountControl", () => {
  // AC-10a (component part)
  it("signed out: Sign in returns to this path in the current appearance", async () => {
    stubServer({ signed_in: false, roles: [] });
    document.documentElement.setAttribute("data-appearance", "dark");
    renderAt("/s/abc");
    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe("/api/auth/login?next=%2Fs%2Fabc&appearance=dark");
  });

  it("keeps the query string in next and reads light too", async () => {
    stubServer({ signed_in: false, roles: [] });
    document.documentElement.setAttribute("data-appearance", "light");
    renderAt("/?q=rev");
    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe("/api/auth/login?next=%2F%3Fq%3Drev&appearance=light");
  });

  it("signed in: shows the name, and Sign out signs out", async () => {
    const fetchMock = stubServer({ signed_in: true, name: "Ada Editor", roles: ["editor"] });
    const onSignedOut = renderAt("/");
    const account = await screen.findByRole("button", { name: "Ada Editor" });
    expect(account.getAttribute("popovertarget")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sign out", hidden: true }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("AccountControl under a base path (spec 005 FR1)", () => {
  it("signs in under the base, with next router-relative and not prefixed twice", async () => {
    mockedBase.value = "/collab/";
    stubServer({ signed_in: false, roles: [] });
    document.documentElement.setAttribute("data-appearance", "dark");
    renderAt("/s/abc");
    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe(
      "/collab/api/auth/login?next=%2Fs%2Fabc&appearance=dark",
    );
  });
});
