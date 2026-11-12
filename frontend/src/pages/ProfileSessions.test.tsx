import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me, RecentSession } from "../api/types";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { ProfileSessions } from "./ProfileSessions";
import { ProfileWindow } from "./ProfileWindow";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 3_600_000;

// FR-2 scenario: P1 now, L1 an hour ago, S1 yesterday (stale), newest first as the server orders.
const P1: RecentSession = {
  kind: "presentation",
  invite_id: "p1invite",
  title: "Graphs talk",
  last_activity_at: ago(0),
  stale: false,
  hosted_by_me: true,
  can_delete: true,
};
const P2: RecentSession = {
  ...P1,
  invite_id: "p2invite",
  title: "Other talk",
  hosted_by_me: false,
  can_delete: false,
};
const L1: RecentSession = {
  kind: "learning",
  invite_id: "l1invite",
  title: "Recursion lesson",
  last_activity_at: ago(HOUR),
  stale: false,
  hosted_by_me: false,
  can_delete: false,
};
const S1: RecentSession = {
  kind: "coding",
  invite_id: "s1invite",
  title: "Two Sum",
  last_activity_at: ago(26 * HOUR),
  stale: true,
  hosted_by_me: false,
  can_delete: false,
};

const C1: RecentSession = {
  kind: "chess",
  invite_id: "c1invite",
  title: "Chess with Sam",
  last_activity_at: ago(HOUR),
  stale: false,
  hosted_by_me: true,
  can_delete: true,
};
const C2: RecentSession = {
  ...C1,
  invite_id: "c2invite",
  title: "Chess club",
  hosted_by_me: false,
  can_delete: false,
};

function stubServer(sessions: RecentSession[], me?: Me, deleteResponse?: () => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (init?.method === "DELETE") return deleteResponse?.() ?? new Response(null, { status: 204 });
    if (url.pathname === "/api/me" && me) return new Response(JSON.stringify(me), { status: 200 });
    if (url.pathname === "/api/me/sessions" && (init?.method ?? "GET") === "GET")
      return new Response(JSON.stringify(sessions), { status: 200 });
    if (url.pathname.endsWith("/hide") && init?.method === "POST")
      return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderSessions(sessions: RecentSession[], deleteResponse?: () => Response) {
  const fetchMock = stubServer(sessions, undefined, deleteResponse);
  render(
    <MemoryRouter>
      <ProfileSessions now={() => NOW} />
    </MemoryRouter>,
  );
  return fetchMock;
}

const bodyRows = async () => {
  const table = await screen.findByRole("table", { name: "Sessions" });
  return within(table).getAllByRole("row").slice(1);
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProfileSessions", () => {
  it("AC-28 (FR-31): chess sessions are labelled Chess and link to their chess route", async () => {
    renderSessions([C1, C2]);
    const rows = await bodyRows();
    expect(rows).toHaveLength(2);
    for (const [row, c] of [
      [rows[0] as HTMLElement, C1],
      [rows[1] as HTMLElement, C2],
    ] as const) {
      expect(within(row).getAllByRole("cell")[0]?.textContent).toBe("Chess");
      expect(within(row).getByRole("link", { name: c.title }).getAttribute("href")).toBe(
        `/games/chess/s/${c.invite_id}`,
      );
    }
  });

  it("FR-2: lists P1, L1, S1 in the given order with kind, title, last activity and status", async () => {
    renderSessions([P1, L1, S1]);
    const table = await screen.findByRole("table", { name: "Sessions" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers.slice(0, 4)).toEqual(["Kind", "Title", "Last activity", "Status"]);

    const rows = await bodyRows();
    expect(rows).toHaveLength(3);
    const column = (i: number) => rows.map((r) => within(r).getAllByRole("cell")[i]?.textContent);
    expect(column(0)).toEqual(["Presentation", "Learning", "Coding"]);
    expect(column(1)).toEqual(["Graphs talk", "Recursion lesson", "Two Sum"]);
    expect(column(2)).toEqual(["just now", "1 hour ago", "1 day ago"]);
    // The exact time stays available to everyone, not just the relative text.
    expect(screen.getByText("1 hour ago").getAttribute("dateTime")).toBe(L1.last_activity_at);
  });

  it("links each title to its kind's session route", async () => {
    renderSessions([P1, L1, S1]);
    await bodyRows();
    expect(screen.getByRole("link", { name: "Graphs talk" }).getAttribute("href")).toBe(
      "/present/s/p1invite",
    );
    expect(screen.getByRole("link", { name: "Recursion lesson" }).getAttribute("href")).toBe(
      "/learn/s/l1invite",
    );
    expect(screen.getByRole("link", { name: "Two Sum" }).getAttribute("href")).toBe("/s/s1invite");
  });

  it("FR-4: a stale session shows the Stale badge and still links to the normal route", async () => {
    renderSessions([L1, S1]);
    const [l1Row, s1Row] = (await bodyRows()) as [HTMLElement, HTMLElement];
    expect(within(s1Row).getByText("Stale")).toBeTruthy();
    expect(within(l1Row).queryByText("Stale")).toBeNull();
    expect(within(s1Row).getByRole("link", { name: "Two Sum" }).getAttribute("href")).toBe(
      "/s/s1invite",
    );
  });

  it("FR-12: only hosted_by_me rows carry the Hosted by you badge", async () => {
    renderSessions([P1, P2]);
    const [p1Row, p2Row] = (await bodyRows()) as [HTMLElement, HTMLElement];
    expect(within(p1Row).getByText("Hosted by you")).toBeTruthy();
    expect(within(p2Row).queryByText("Hosted by you")).toBeNull();
  });

  it("FR-13: Hide calls hideMySession for that session and removes the row", async () => {
    const fetchMock = renderSessions([L1, S1]);
    await bodyRows();
    fireEvent.click(screen.getByRole("button", { name: "Hide Two Sum" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Two Sum" })).toBeNull());
    const hide = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(new URL(String(hide?.[0]), "http://localhost").pathname).toBe(
      "/api/me/sessions/coding/s1invite/hide",
    );
    expect(screen.getByRole("link", { name: "Recursion lesson" })).toBeTruthy();
  });

  it("019 AC-1/AC-3: only rows with can_delete show a Delete button named for the session", async () => {
    // A hosted session of every kind (AC-1), and one the user only joined (AC-3).
    const hosted: RecentSession[] = [
      P1,
      { ...L1, hosted_by_me: true, can_delete: true },
      { ...S1, hosted_by_me: true, can_delete: true },
      C1,
    ];
    renderSessions([...hosted, P2]);
    const rows = await bodyRows();
    for (const [i, s] of hosted.entries()) {
      const row = rows[i] as HTMLElement;
      const buttons = within(row)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"));
      // Delete comes after Hide.
      expect(buttons).toEqual([`Hide ${s.title}`, `Delete ${s.title}`]);
    }
    const p2Row = rows[4] as HTMLElement;
    expect(within(p2Row).getByRole("button", { name: "Hide Other talk" })).toBeTruthy();
    expect(within(p2Row).queryByRole("button", { name: /^Delete/ })).toBeNull();
  });

  const deleteCalls = (fetchMock: ReturnType<typeof stubServer>) =>
    fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");

  async function openDelete(title: string) {
    await bodyRows();
    const button = screen.getByRole("button", { name: `Delete ${title}` });
    button.focus();
    fireEvent.click(button);
    return { button, dialog: screen.getByRole("dialog", { name: `Delete ${title}?` }) };
  }

  it("019 AC-4: Delete asks for confirmation naming the session, for everyone, not undoable", async () => {
    const fetchMock = renderSessions([P1]);
    const { dialog } = await openDelete("Graphs talk");
    expect(dialog.textContent).toContain(
      "This deletes the session for everyone. It can't be undone.",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(deleteCalls(fetchMock)).toHaveLength(0);
  });

  it("019 AC-4: Cancel sends nothing, keeps the row and returns focus to Delete", async () => {
    const fetchMock = renderSessions([P1]);
    const { button, dialog } = await openDelete("Graphs talk");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteCalls(fetchMock)).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Graphs talk" })).toBeTruthy();
    expect(document.activeElement).toBe(button);
  });

  it("019 AC-4: Escape sends nothing, keeps the row and returns focus to Delete", async () => {
    const fetchMock = renderSessions([P1]);
    const { button, dialog } = await openDelete("Graphs talk");
    // A native <dialog> turns Escape into a cancel event.
    act(() => {
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteCalls(fetchMock)).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Graphs talk" })).toBeTruthy();
    expect(document.activeElement).toBe(button);
  });

  it("019 AC-5: confirming sends DELETE, removes the row and announces it politely", async () => {
    const fetchMock = renderSessions([P1, C1]);
    const { dialog } = await openDelete("Chess with Sam");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Chess with Sam" })).toBeNull());
    const [call] = deleteCalls(fetchMock);
    expect(new URL(String(call?.[0]), "http://localhost").pathname).toBe(
      "/api/me/sessions/chess/c1invite",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Deleted Chess with Sam");
    expect(screen.getByRole("link", { name: "Graphs talk" })).toBeTruthy();
  });

  it("019 AC-9: a 410 removes the row and says it was already deleted", async () => {
    renderSessions(
      [P1],
      () => new Response(JSON.stringify({ error: "session_deleted" }), { status: 410 }),
    );
    const { dialog } = await openDelete("Graphs talk");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Graphs talk" })).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("Graphs talk was already deleted");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("019 AC-9: a 500 keeps the row and shows the error in the list", async () => {
    renderSessions([P1], () => new Response("boom", { status: 500 }));
    const { dialog } = await openDelete("Graphs talk");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not delete “Graphs talk”.",
    );
    expect(screen.getByRole("link", { name: "Graphs talk" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("019 FR-11: a 403 not_host keeps the row and says the user may no longer delete it", async () => {
    renderSessions(
      [P1],
      () => new Response(JSON.stringify({ error: "not_host" }), { status: 403 }),
    );
    const { dialog } = await openDelete("Graphs talk");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "You can no longer delete “Graphs talk”.",
    );
    expect(screen.getByRole("link", { name: "Graphs talk" })).toBeTruthy();
  });

  it("shows an empty state when there are no sessions", async () => {
    renderSessions([]);
    expect(await screen.findByText("No recent sessions")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("FR-10: a signed-out profile has no sessions section", async () => {
    stubServer([P1], { signed_in: false, roles: [] });
    render(
      <ShortcutsProvider>
        <MemoryRouter initialEntries={["/profile"]}>
          <Routes>
            <Route path="/profile" element={<ProfileWindow />} />
          </Routes>
        </MemoryRouter>
      </ShortcutsProvider>,
    );
    expect(await screen.findByText("You're not signed in")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Sessions" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Sessions" })).toBeNull();
    // The shared header's live check may call /api/me/sessions; the profile must not list its rows.
    expect(screen.queryByText(P1.title)).toBeNull();
  });
});
