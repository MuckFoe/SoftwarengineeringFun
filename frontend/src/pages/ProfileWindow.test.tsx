import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerUrl } from "../api/client";
import type { Me } from "../api/types";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { ProfileWindow } from "./ProfileWindow";

const SIGNED_OUT: Me = { signed_in: false, roles: [] };
const EDITOR: Me = { signed_in: true, name: "newuser", roles: ["editor"], preferences: null };
const NO_ROLE: Me = { signed_in: true, name: "other", roles: [], preferences: null };
const DARK_USER: Me = {
  signed_in: true,
  name: "newuser",
  roles: ["editor"],
  preferences: { appearance: "dark", chat_visible: true },
};

// The backend is not part of this unit; only the HTTP boundary is stubbed.
function stubServer(me: Me) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/me") return new Response(JSON.stringify(me), { status: 200 });
    if (url.pathname === "/api/auth/logout" && init?.method === "POST")
      return new Response(null, { status: 204 });
    if (url.pathname === "/api/me/preferences" && init?.method === "PUT")
      return new Response(String(init.body), { status: 200 });
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function Where() {
  const { pathname, search } = useLocation();
  return <output aria-label="location">{`${pathname}${search}`}</output>;
}

function renderProfile(me: Me, path = "/profile?from=%2Fs%2Fabc", onSignedOut = vi.fn()) {
  const fetchMock = stubServer(me);
  render(
    <ShortcutsProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/profile" element={<ProfileWindow onSignedOut={onSignedOut} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ShortcutsProvider>,
  );
  return { fetchMock, onSignedOut };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-appearance");
  localStorage.clear();
});

/** The bodies of every preferences PUT so far. */
function preferencePuts(fetchMock: ReturnType<typeof stubServer>): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input) === "/api/me/preferences" && init?.method === "PUT")
    .map(([, init]) => JSON.parse(String(init?.body)));
}

describe("ProfileWindow", () => {
  it("is a window whose back button returns to where the profile was opened from", async () => {
    renderProfile(SIGNED_OUT);
    const toolbar = screen.getByRole("toolbar", { name: "Profile" });
    const back = within(toolbar).getByRole("link", { name: "Back" });
    expect(back.getAttribute("href")).toBe("/s/abc");
    fireEvent.click(back);
    expect(await screen.findByRole("status", { name: "location" })).toHaveProperty(
      "textContent",
      "/s/abc",
    );
  });

  it("goes back home when from is missing or leaves the app", () => {
    renderProfile(SIGNED_OUT, "/profile?from=%2F%2Fevil.example");
    expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe("/");
    cleanup();
    renderProfile(SIGNED_OUT, "/profile");
    expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe("/");
  });

  // FR-10
  it("signed out: only Sign in and Register, and no sessions or preferences", async () => {
    document.documentElement.setAttribute("data-appearance", "dark");
    renderProfile(SIGNED_OUT);
    const main = screen.getByRole("main");
    const signIn = await within(main).findByRole("link", { name: "Sign in" });
    const register = within(main).getByRole("link", { name: "Register" });
    const next = "/profile?from=%2Fs%2Fabc";
    expect(signIn.getAttribute("href")).toBe(
      `/api/auth/login?next=${encodeURIComponent(next)}&appearance=dark`,
    );
    expect(register.getAttribute("href")).toBe(registerUrl(next));
    expect(register.getAttribute("href")).toContain("/api/auth/register?");
    // Exactly those two actions.
    expect(main.querySelectorAll("a, button, input, select, textarea")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: /sessions/i })).toBeNull();
    expect(screen.queryByRole("region", { name: /preferences/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  // FR-11
  it("signed in: username and roles as text, nothing editable, and Sign out signs out", async () => {
    const { fetchMock, onSignedOut } = renderProfile(EDITOR);
    const main = screen.getByRole("main");
    const account = await within(main).findByRole("region", { name: "Account" });
    expect(within(account).getByText("newuser")).toBeTruthy();
    expect(within(account).getByText("editor")).toBeTruthy();
    expect(account.querySelectorAll("input, select, textarea, [contenteditable]")).toHaveLength(0);
    expect(within(main).queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(within(main).queryByRole("link", { name: "Register" })).toBeNull();

    fireEvent.click(within(account).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("a user with no role in this app shows none", async () => {
    renderProfile(NO_ROLE);
    const account = await screen.findByRole("region", { name: "Account" });
    expect(within(account).getByText("other")).toBeTruthy();
    expect(within(account).getByText("none")).toBeTruthy();
  });

  // FR-18
  it("signed in: choosing Light in Preferences turns the app light at once and saves it", async () => {
    const { fetchMock } = renderProfile(DARK_USER);
    const prefs = await screen.findByRole("region", { name: "Preferences" });
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-appearance")).toBe("dark"),
    );
    const group = within(prefs).getByRole("radiogroup", { name: "Appearance" });
    expect(within(group).getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe(
      "true",
    );

    fireEvent.click(within(group).getByRole("radio", { name: "Light" }));
    expect(document.documentElement.getAttribute("data-appearance")).toBe("light");
    expect(within(group).getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(preferencePuts(fetchMock)).toEqual([{ appearance: "light" }]);
  });

  // FR-18
  it("signed in: the chat checkbox shows the preference and saves chat_visible", async () => {
    const { fetchMock } = renderProfile(DARK_USER);
    const prefs = await screen.findByRole("region", { name: "Preferences" });
    const chat = within(prefs).getByRole("checkbox", { name: "Show chat beside the description" });
    expect((chat as HTMLInputElement).checked).toBe(true);

    fireEvent.click(chat);
    expect((chat as HTMLInputElement).checked).toBe(false);
    expect(localStorage.getItem("chatVisible")).toBe("hidden");
    expect(preferencePuts(fetchMock)).toEqual([{ chat_visible: false }]);

    fireEvent.click(chat);
    expect((chat as HTMLInputElement).checked).toBe(true);
    expect(preferencePuts(fetchMock)).toEqual([{ chat_visible: false }, { chat_visible: true }]);
  });

  // NFR-5 (unit level)
  it("signed in: Sign out, appearance, text size, then the chat checkbox, in Tab order", async () => {
    renderProfile(DARK_USER);
    const main = screen.getByRole("main");
    const account = await within(main).findByRole("region", { name: "Account" });
    const prefs = within(main).getByRole("region", { name: "Preferences" });
    // Preferences follow Account, and nothing jumps the order with a positive tabIndex,
    // so document order is Tab order.
    expect(account.compareDocumentPosition(prefs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      main.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])'),
    ).toHaveLength(0);
    const stops = [account, prefs]
      .flatMap((r) => [
        ...r.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea"),
      ])
      .filter((el) => el.tabIndex >= 0 && !el.hasAttribute("disabled"));
    expect(stops.map((el) => (el.closest("label") ?? el).textContent?.trim())).toEqual([
      "Sign out",
      "Dark",
      "S",
      "Show chat beside the description",
    ]);
  });
});
