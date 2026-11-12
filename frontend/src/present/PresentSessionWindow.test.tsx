import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, Me } from "../api/types";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import type { FrameLink } from "./frameLink";
import { PresentSessionWindow } from "./PresentSessionWindow";
import type { SocketFactory, SocketLike } from "./presentSocket";
import type {
  PresentParticipant,
  PresentServerMessage,
  PresentSessionState,
  PresentWelcomeMessage,
} from "./presentTypes";

// The backend is not part of this unit: fetch and the WebSocket are stubbed at the boundary
// (plan.md "Contracts"), and the frame link is a do-nothing fake (bridge.js runs only in a
// real browser; PresentationFrame's own tests cover the overlay).

class FakeSocket implements SocketLike {
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  readonly sent: string[] = [];
  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {}

  open() {
    act(() => this.onopen?.(new Event("open")));
  }

  receive(message: PresentServerMessage) {
    act(() => this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent));
  }

  closeWith(code: number) {
    act(() => this.onclose?.({ code } as CloseEvent));
  }

  messages() {
    return this.sent.map((s) => JSON.parse(s) as { type: string } & Record<string, unknown>);
  }
}

function fakeSockets(): { factory: SocketFactory; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    factory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  };
}

function fakeLink(): FrameLink {
  return {
    show: () => {},
    follow: () => {},
    resolve: async () => null,
    anchorAt: async () => null,
    on: () => () => {},
    destroy: () => {},
  };
}

const ANA: PresentParticipant = { id: "p-ana", name: "Ana", color: 0 };
const BEN: PresentParticipant = { id: "p-ben", name: "Ben", color: 1 };
const CLEO: PresentParticipant = { id: "p-cleo", name: "Cleo", color: 2 };

const CHAT: ChatMessage[] = [
  {
    id: 7,
    sender_name: "Ben",
    participant_id: "p",
    signed_in: false,
    text: "hello",
    sent_at: "2026-11-03T10:00:00Z",
  },
];

function sessionState(extra: Partial<PresentSessionState> = {}): PresentSessionState {
  return {
    title: "TCP handshakes",
    topic: "Networking",
    kind: "slides",
    slide_count: 4,
    available: true,
    stale: false,
    can_reactivate: false,
    host_name: "Ana",
    place: { slide: 0, anchor: null },
    ...extra,
  };
}

function welcome(
  you: PresentParticipant,
  extra: Partial<PresentWelcomeMessage> = {},
): PresentWelcomeMessage {
  return {
    type: "welcome",
    you: { participant_id: you.id, rejoin_token: `tok-${you.id}`, name: you.name },
    available: true,
    kind: "slides",
    slide_count: 4,
    host: { id: ANA.id, name: ANA.name, away: false },
    place: { slide: 0, anchor: null },
    participants: [ANA, BEN, CLEO],
    strokes: [],
    chat: CHAT,
    ...extra,
  };
}

interface ServerOptions {
  state?: PresentSessionState | { status: number; body: unknown };
  me?: Me;
  reactivate?: { status: number; body: unknown };
}

function stubServer({
  state: initial = sessionState(),
  me = { signed_in: false, roles: [] },
  reactivate = { status: 200, body: {} },
}: ServerOptions = {}) {
  let state = initial;
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    const path = url.pathname;
    if (path === "/api/me") return json(me);
    if (method === "GET" && path === "/api/present/sessions/abc") {
      return "status" in state ? json(state.body, state.status) : json(state);
    }
    if (method === "GET" && path === "/api/present/sessions/abc/chat") {
      return json({ messages: CHAT, read_only: true });
    }
    if (method === "POST" && path === "/api/present/sessions/abc/reactivate") {
      if (reactivate.status === 200 && !("status" in state)) state = { ...state, stale: false };
      return json(reactivate.body, reactivate.status);
    }
    return json({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderPage(createSocket: SocketFactory) {
  return render(
    <ShortcutsProvider>
      <MemoryRouter initialEntries={["/present/s/abc"]}>
        <Routes>
          <Route
            path="/present/s/:invite"
            element={<PresentSessionWindow createSocket={createSocket} createLink={fakeLink} />}
          />
        </Routes>
      </MemoryRouter>
    </ShortcutsProvider>,
  );
}

async function joinAs(name: string, sockets: FakeSocket[]) {
  fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /join/i }));
  const socket = sockets.at(-1);
  if (!socket) throw new Error("no socket opened");
  return socket;
}

/** Joins as `you` and plays the server's welcome. */
async function joined(you: PresentParticipant, extra: Partial<PresentWelcomeMessage> = {}) {
  const { factory, sockets } = fakeSockets();
  renderPage(factory);
  const socket = await joinAs(you.name, sockets);
  socket.open();
  socket.receive(welcome(you, extra));
  return socket;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const sentOf = (socket: FakeSocket, type: string) =>
  socket.messages().filter((m) => m.type === type);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("PresentSessionWindow: joining (FR-9)", () => {
  it("asks for a name, refuses 31 characters, and connects with the trimmed name", async () => {
    stubServer();
    const { factory, sockets } = fakeSockets();
    renderPage(factory);

    fireEvent.change(await screen.findByLabelText("Your name"), {
      target: { value: "a".repeat(31) },
    });
    fireEvent.click(button(/join/i));
    expect(screen.getByText(/1 to 30 characters/)).toBeTruthy();
    expect(sockets).toHaveLength(0);

    const socket = await joinAs("  Ben ", sockets);
    expect(socket.url).toContain("/api/present/sessions/abc/ws?name=Ben");
  });

  it("FR-16: with a stored identity it skips the prompt and rejoins with the token", async () => {
    stubServer();
    localStorage.setItem("present:abc", JSON.stringify({ name: "Ana", rejoin_token: "tok-1" }));
    const { factory, sockets } = fakeSockets();
    renderPage(factory);

    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(screen.queryByLabelText("Your name")).toBeNull();
    expect(sockets[0]?.url).toContain("name=Ana");
    expect(sockets[0]?.url).toContain("rejoin=tok-1");
  });

  it("AC-9: a full session (4403) says it is full and asks again", async () => {
    stubServer();
    const { factory, sockets } = fakeSockets();
    renderPage(factory);
    const socket = await joinAs("Fay", sockets);
    socket.closeWith(4403);
    expect(await screen.findByText(/session is full/i)).toBeTruthy();
    expect(screen.getByLabelText("Your name")).toBeTruthy();
  });

  it("an unknown invite shows not found", async () => {
    stubServer({ state: { status: 404, body: { error: "not_found" } } });
    renderPage(fakeSockets().factory);
    expect(await screen.findByText(/session not found/i)).toBeTruthy();
  });
});

describe("PresentSessionWindow: signed in (spec 012)", () => {
  const NEWUSER: Me = { signed_in: true, name: "newuser", roles: [], preferences: null };
  const YOU: PresentParticipant = { id: "p-new", name: "newuser", color: 0 };

  it("FR-1: joins as the account without a name sheet; the socket has no name", async () => {
    stubServer({ me: NEWUSER });
    const { factory, sockets } = fakeSockets();
    renderPage(factory);

    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(screen.queryByLabelText("Your name")).toBeNull();
    const socket = sockets[0] as FakeSocket;
    expect(socket.url).toMatch(/\/api\/present\/sessions\/abc\/ws$/);
    socket.open();
    socket.receive(welcome(YOU));
    expect(await screen.findByRole("list", { name: "Participants" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("present:abc") ?? "null")).toEqual({
      name: "newuser",
      rejoin_token: "tok-p-new",
    });
  });

  it("FR-5: a stored anonymous identity is not used; the account decides", async () => {
    stubServer({ me: NEWUSER });
    localStorage.setItem("present:abc", JSON.stringify({ name: "Ana", rejoin_token: "tok-1" }));
    const { factory, sockets } = fakeSockets();
    renderPage(factory);

    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(sockets[0]?.url).not.toContain("name=");
    expect(sockets[0]?.url).not.toContain("rejoin=");
  });

  it("4409: says it was opened elsewhere, with no name sheet, and Join reconnects", async () => {
    stubServer({ me: NEWUSER });
    const { factory, sockets } = fakeSockets();
    renderPage(factory);
    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0] as FakeSocket;
    socket.open();
    socket.receive(welcome(YOU));
    socket.closeWith(4409);

    expect(await screen.findByText(/opened in another tab or window/i)).toBeTruthy();
    expect(screen.queryByLabelText("Your name")).toBeNull();
    expect(sockets).toHaveLength(1);
    fireEvent.click(button(/join/i));
    expect(sockets).toHaveLength(2);
    expect(sockets[1]?.url).not.toContain("name=");
  });

  it("FR-6: signed out still gets the name sheet", async () => {
    stubServer({ me: { signed_in: false, roles: [] } });
    const { factory, sockets } = fakeSockets();
    renderPage(factory);
    expect(await screen.findByLabelText("Your name")).toBeTruthy();
    expect(sockets).toHaveLength(0);
  });
});

describe("PresentSessionWindow: following and hosting", () => {
  it("AC-8: the host sees enabled ◀ ▶ at 1 / 4, and ▶ sends the next slide", async () => {
    stubServer();
    const socket = await joined(ANA);

    expect(screen.getByText("1 / 4")).toBeTruthy();
    const prev = button("Previous slide") as HTMLButtonElement;
    const next = button("Next slide") as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    expect(screen.getByTitle("TCP handshakes").tagName).toBe("IFRAME");

    fireEvent.click(next);
    expect(sentOf(socket, "place")).toEqual([{ type: "place", slide: 1, anchor: null }]);

    socket.receive({ type: "place", slide: 1, anchor: null });
    expect(screen.getByText("2 / 4")).toBeTruthy();
  });

  it("AC-8: the host steps slides with the arrow keys and PageUp / PageDown", async () => {
    stubServer();
    const socket = await joined(ANA, { place: { slide: 1, anchor: null } });

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "PageUp" });
    expect(sentOf(socket, "place")).toEqual([
      { type: "place", slide: 2, anchor: null },
      { type: "place", slide: 0, anchor: null },
    ]);
  });

  it("AC-13: a follower's ◀ ▶ are disabled and arrow keys send nothing", async () => {
    stubServer();
    const socket = await joined(BEN, { place: { slide: 1, anchor: null } });

    expect(screen.getByText("2 / 4")).toBeTruthy();
    expect((button("Previous slide") as HTMLButtonElement).disabled).toBe(true);
    expect((button("Next slide") as HTMLButtonElement).disabled).toBe(true);

    for (const key of ["ArrowRight", "ArrowLeft", "PageDown", "PageUp"]) {
      fireEvent.keyDown(window, { key });
    }
    expect(sentOf(socket, "place")).toEqual([]);
    expect(screen.queryByRole("button", { name: /hand over/i })).toBeNull();
  });

  it("AC-15: `host away` shows a banner naming the host, which goes when she returns", async () => {
    stubServer();
    const socket = await joined(BEN);

    socket.receive({
      type: "host",
      host: { id: ANA.id, name: "Ana", away: true },
      reason: "away",
    });
    expect(screen.getByRole("status").textContent).toMatch(/Ana.*away/);

    socket.receive({
      type: "host",
      host: { id: ANA.id, name: "Ana", away: false },
      reason: "returned",
    });
    expect(screen.queryByText(/away/)).toBeNull();
  });

  it("AC-15b: the host hands over to Cleo from the menu of connected participants", async () => {
    stubServer();
    const socket = await joined(ANA);

    fireEvent.click(button(/hand over/i));
    // jsdom has no popover API, so the panel counts as hidden (and its names as empty);
    // the browser opens it.
    const menu = screen
      .getAllByRole("dialog", { hidden: true })
      .find((d) => d.getAttribute("aria-label") === "Hand over…");
    if (!menu) throw new Error("no hand-over menu");
    const items = within(menu).getAllByRole("button", { hidden: true });
    expect(items.map((b) => b.textContent)).toEqual(["Ben", "Cleo"]);
    fireEvent.click(items[1] as HTMLElement);
    expect(sentOf(socket, "hand_over")).toEqual([{ type: "hand_over", participant_id: CLEO.id }]);

    socket.receive({
      type: "host",
      host: { id: CLEO.id, name: "Cleo", away: false },
      reason: "handover",
    });
    expect((button("Next slide") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /hand over/i })).toBeNull();
  });

  it("FR-8: the participant list marks the host and shows each colour", async () => {
    stubServer();
    await joined(BEN);

    const list = screen.getByRole("list", { name: "Participants" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["Ana (host)", "Ben (you)", "Cleo"]);
    const swatch = rows[0]?.querySelector("[data-swatch]") as HTMLElement;
    expect(swatch.style.background).toBe("rgb(229, 56, 59)"); // STROKE_COLORS[0] for index 0
  });

  it("012 FR-8: the host's name carries the signed-in mark exactly when host.signed_in", async () => {
    stubServer();
    const socket = await joined(BEN, {
      host: { id: ANA.id, name: ANA.name, away: false, signed_in: true },
    });
    const hostRow = () =>
      within(screen.getByRole("list", { name: "Participants" })).getAllByRole("listitem")[0];
    expect(hostRow()?.querySelector("[data-signed-in]")).not.toBeNull();

    socket.receive({
      type: "host",
      host: { id: ANA.id, name: "Ana", away: true, signed_in: true },
      reason: "away",
    });
    expect(screen.getByRole("status").querySelector("[data-signed-in]")).not.toBeNull();

    socket.receive({
      type: "host",
      host: { id: CLEO.id, name: "Cleo", away: true, signed_in: false },
      reason: "handover",
    });
    expect(screen.getByRole("status").querySelector("[data-signed-in]")).toBeNull();
    const list = screen.getByRole("list", { name: "Participants" });
    expect(list.querySelector("[data-signed-in]")).toBeNull();
  });

  it("012 FR-8: any signed-in participant in the list carries the mark, not only the host", async () => {
    stubServer();
    const socket = await joined(BEN);
    socket.receive({
      type: "presence",
      participants: [
        { ...ANA, signed_in: false },
        { ...BEN, signed_in: false },
        { ...CLEO, name: "Ana", signed_in: true },
      ],
    });
    const rows = within(screen.getByRole("list", { name: "Participants" })).getAllByRole(
      "listitem",
    );
    expect(rows.map((r) => r.querySelector("[data-signed-in]") !== null)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("AC-5: `presentation_removed` replaces the frame with the message", async () => {
    stubServer();
    const socket = await joined(BEN);

    socket.receive({ type: "presentation_removed" });
    expect(screen.queryByTitle("TCP handshakes")).toBeNull();
    expect(screen.getByText(/no longer available/i)).toBeTruthy();
  });
});

describe("PresentSessionWindow: drawing (FR-19, FR-22)", () => {
  it("AC-18/AC-21: Draw toggles aria-pressed; Clear drawings sends clear_drawings", async () => {
    stubServer();
    const socket = await joined(BEN);

    const draw = button("Draw");
    expect(draw.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(draw);
    expect(draw.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("present-overlay").style.pointerEvents).toBe("auto");
    // FR-19: the toggle is local only.
    expect(socket.messages().map((m) => m.type)).toEqual([]);

    fireEvent.click(button("Clear drawings"));
    expect(sentOf(socket, "clear_drawings")).toEqual([{ type: "clear_drawings" }]);
  });
});

describe("PresentSessionWindow: chat (FR-32)", () => {
  it("AC-15h: chat shows the history from welcome and a GIF button", async () => {
    stubServer();
    await joined(BEN);

    expect(screen.getByText("hello")).toBeTruthy();
    expect(button("GIF")).toBeTruthy();
  });
});

describe("PresentSessionWindow: stale (FR-31)", () => {
  it("AC-15g: no socket, the frame at the stored place, chat read-only, no Reactivate", async () => {
    stubServer({ state: sessionState({ stale: true, place: { slide: 2, anchor: null } }) });
    localStorage.setItem("present:abc", JSON.stringify({ name: "Ana", rejoin_token: "tok-1" }));
    const { factory, sockets } = fakeSockets();
    renderPage(factory);

    expect(await screen.findByText(/gone stale/i)).toBeTruthy();
    expect(sockets).toHaveLength(0);
    expect(screen.getByText("3 / 4")).toBeTruthy();
    const frame = screen.getByTitle("TCP handshakes") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("/api/present/sessions/abc/frame#slide=2");
    expect(await screen.findByText("hello")).toBeTruthy();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "GIF" })).toBeNull();
    expect((button("Next slide") as HTMLButtonElement).disabled).toBe(true);
    expect((button("Draw") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Reactivate" })).toBeNull();
  });

  it("AC-15g: an admin reactivates, and the page then joins", async () => {
    const fetch = stubServer({
      state: sessionState({ stale: true, can_reactivate: true }),
      me: { signed_in: true, roles: ["admin"], name: "Root", preferences: null },
    });
    const { factory, sockets } = fakeSockets();
    renderPage(factory);

    fireEvent.click(await screen.findByRole("button", { name: "Reactivate" }));
    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(
      fetch.mock.calls.some(
        ([url, init]) => String(url).endsWith("/abc/reactivate") && init?.method === "POST",
      ),
    ).toBe(true);
    // Signed in, so the admin joins as their account (spec 012 FR-1).
    expect(sockets[0]?.url).toMatch(/\/abc\/ws$/);
  });

  it("a 4410 close while joined switches to the stale view", async () => {
    stubServer();
    const socket = await joined(BEN);
    stubServer({ state: sessionState({ stale: true }) });

    socket.closeWith(4410);
    expect(await screen.findByText(/gone stale/i)).toBeTruthy();
  });
});

describe("PresentSessionWindow: accessibility (NFR-6)", () => {
  it("AC-25: every toolbar control is a native button with an accessible name", async () => {
    stubServer();
    await joined(ANA);

    const toolbar = screen.getByRole("toolbar", { name: "Presentation session" });
    for (const name of ["Previous slide", "Next slide", "Draw", "Clear drawings"]) {
      expect(within(toolbar).getByRole("button", { name }).tagName).toBe("BUTTON");
    }
    expect(within(toolbar).getByRole("button", { name: /hand over/i }).tagName).toBe("BUTTON");
    const unnamed = within(toolbar)
      .getAllByRole("button")
      .filter((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === "");
    expect(unnamed).toEqual([]);
  });
});

describe("PresentSessionWindow: deleted (spec 019 FR-7, FR-8)", () => {
  it("AC-7: a 410 session_deleted shows that the session was deleted, with a link home", async () => {
    stubServer({ state: { status: 410, body: { error: "session_deleted" } } });
    renderPage(fakeSockets().factory);

    expect(await screen.findByRole("heading", { name: "This session was deleted" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
    expect(screen.queryByText(/could not load/i)).toBeNull();
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });

  it("AC-6: session_deleted by the host, then close 4411, shows the deleted state", async () => {
    stubServer();
    const socket = await joined(BEN);
    await screen.findByRole("button", { name: "Draw" });

    act(() =>
      socket.onmessage?.({
        data: JSON.stringify({ type: "session_deleted", by: "host" }),
      } as MessageEvent),
    );
    socket.closeWith(4411);

    expect(await screen.findByRole("heading", { name: "This session was deleted" })).toBeTruthy();
    expect(screen.getByText("The host deleted it.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to home" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Draw" })).toBeNull();
    expect(screen.queryByText(/disconnected/i)).toBeNull();
  });

  it("a close 4411 without the message still shows the deleted state", async () => {
    stubServer();
    const socket = await joined(BEN);
    await screen.findByRole("button", { name: "Draw" });

    socket.closeWith(4411);

    await screen.findByRole("heading", { name: "This session was deleted" });
    expect(screen.queryByText(/deleted it\./)).toBeNull();
  });
});
