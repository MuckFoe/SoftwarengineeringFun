import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../api/types";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { PresentWindow } from "./PresentWindow";
import type { PresentationSummary } from "./presentTypes";

// plan.md REST: GET /api/present/presentations → [{id, title, topic, kind, slide_count}]
const LIBRARY: PresentationSummary[] = [
  { id: "p1", title: "TCP handshakes", topic: "Networking", kind: "slides", slide_count: 4 },
  { id: "p2", title: "Images and layers", topic: "Docker", kind: "slides", slide_count: 1 },
  { id: "p3", title: "Compose cheat sheet", topic: "Docker", kind: "page", slide_count: 0 },
];

const EDITOR: Me = { signed_in: true, name: "Ed", roles: ["editor"], preferences: null };
const SIGNED_IN: Me = { signed_in: true, name: "Bo", roles: [], preferences: null };
const VISITOR: Me = { signed_in: false, roles: [] };

// The backend is not part of this unit; only the HTTP boundary is stubbed.
function stubServer(me: Me) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.pathname === "/api/me") return json(me);
    if (url.pathname === "/api/present/presentations" && method === "GET") return json(LIBRARY);
    if (url.pathname === "/api/present/sessions" && method === "POST") {
      return json({ invite_id: "pres-inv1" }, 201);
    }
    return json({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function Where() {
  return <output aria-label="location">{useLocation().pathname}</output>;
}

async function renderWindow(me: Me = VISITOR) {
  const fetchMock = stubServer(me);
  render(
    <ShortcutsProvider>
      <MemoryRouter initialEntries={["/present"]}>
        <Routes>
          <Route
            path="/present"
            element={
              <>
                <PresentWindow />
                <Where />
              </>
            }
          />
          <Route path="/present/s/:invite" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ShortcutsProvider>,
  );
  await screen.findByText("TCP handshakes");
  // Let /api/me settle so role-dependent controls are final.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return fetchMock;
}

const pathname = () => screen.getByRole("status", { name: "location" }).textContent;
const rows = () => screen.getAllByRole("row").slice(1); // minus the header row

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PresentWindow", () => {
  it("lists every presentation with title, topic and slide count or single page", async () => {
    await renderWindow();
    expect(rows()).toHaveLength(3);
    const tcp = screen.getByRole("row", { name: /TCP handshakes/ });
    expect(within(tcp).getByText("Networking")).toBeTruthy();
    expect(within(tcp).getByText("4 slides")).toBeTruthy();
    const one = screen.getByRole("row", { name: /Images and layers/ });
    expect(within(one).getByText("1 slide")).toBeTruthy();
    const page = screen.getByRole("row", { name: /Compose cheat sheet/ });
    expect(within(page).getByText("Single page")).toBeTruthy();
  });

  it("AC-6: choosing Docker lists only the Docker presentations, each with title and topic", async () => {
    await renderWindow();
    const topics = screen.getByRole("listbox", { name: "Topics" });
    const names = within(topics)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toEqual(["All", "Docker", "Networking"]);
    expect(within(topics).getByRole("option", { name: "All" }).getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.click(within(topics).getByRole("option", { name: "Docker" }));

    expect(rows()).toHaveLength(2);
    expect(screen.queryByText("TCP handshakes")).toBeNull();
    for (const title of ["Images and layers", "Compose cheat sheet"]) {
      const row = screen.getByRole("row", { name: new RegExp(title) });
      expect(within(row).getByText("Docker")).toBeTruthy();
    }

    fireEvent.click(within(topics).getByRole("option", { name: "All" }));
    expect(rows()).toHaveLength(3);
  });

  it("AC-8: Start session posts {presentation_id} and navigates to the returned invite", async () => {
    const fetchMock = await renderWindow();
    fireEvent.click(screen.getByRole("button", { name: "Start session: TCP handshakes" }));
    await waitFor(() => expect(pathname()).toBe("/present/s/pres-inv1"));
    const post = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === "/api/present/sessions" && init?.method === "POST",
    );
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ presentation_id: "p1" });
  });

  it.each([
    ["not signed in", VISITOR],
    ["signed in without the editor role", SIGNED_IN],
  ])("AC-7: %s sees no add, replace or remove controls", async (_, me) => {
    await renderWindow(me);
    expect(screen.queryByRole("button", { name: /add presentation/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /replace/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    // Starting a session is open to everyone (FR-8).
    expect(screen.getByRole("button", { name: "Start session: TCP handshakes" })).toBeTruthy();
  });

  it("editors see Add, and Replace and Remove on each row", async () => {
    await renderWindow(EDITOR);
    expect(await screen.findByRole("button", { name: "Add presentation" })).toBeTruthy();
    const tcp = screen.getByRole("row", { name: /TCP handshakes/ });
    expect(within(tcp).getByRole("button", { name: "Replace HTML: TCP handshakes" })).toBeTruthy();
    expect(within(tcp).getByRole("button", { name: "Remove: TCP handshakes" })).toBeTruthy();
  });

  it("shows a message when the library cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/me"
          ? new Response(JSON.stringify(VISITOR), { status: 200 })
          : new Response("{}", { status: 500 }),
      ),
    );
    render(
      <ShortcutsProvider>
        <MemoryRouter initialEntries={["/present"]}>
          <PresentWindow />
        </MemoryRouter>
      </ShortcutsProvider>,
    );
    expect(await screen.findByText("Could not load presentations.")).toBeTruthy();
  });
});
