import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsProvider } from "../../shortcuts/useShortcut";
import { ChessSessionWindow } from "./ChessSessionWindow";
import type { SocketLike } from "./chessSocket";
import type { Game, Snapshot } from "./chessTypes";

class FakeSocket implements SocketLike {
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  readonly sent: string[] = [];
  constructor(readonly url: string) {}
  send(d: string) {
    this.sent.push(d);
  }
  close() {}
  receive(m: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(m) } as MessageEvent));
  }
  closeWith(code: number) {
    act(() => this.onclose?.({ code } as CloseEvent));
  }
  frames() {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stub(opts: { signedIn?: boolean; roles?: string[]; session?: Response }) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/api/me") {
        return opts.signedIn
          ? json(200, { signed_in: true, name: "ann", roles: opts.roles ?? [] })
          : json(200, { signed_in: false, name: null, roles: [] });
      }
      if (url.pathname === "/api/games/chess/sessions/abc") {
        return opts.session ?? json(200, { invite_id: "abc", stale: false, full: false });
      }
      return json(404, {});
    }),
  );
  return calls;
}

function game(over: Partial<Game> = {}): Game {
  return {
    status: "in_progress",
    // white pawn on a7 about to promote, kings far away
    fen: "4k3/P7/8/8/8/8/8/4K3 w - - 0 1",
    turn: "white",
    ply: 0,
    moves: [],
    last_move: null,
    check_square: null,
    legal: { a7: ["a8"] },
    promotions: ["a7"],
    draw_offer_by: null,
    claim_available_to: null,
    result: null,
    reason: null,
    ...over,
  };
}

function snap(over: Partial<Snapshot> = {}): Snapshot {
  const white = { participant_id: "p1", name: "ann", signed_in: true, away: false };
  const black = { participant_id: "p2", name: "bob", signed_in: false, away: false };
  return {
    invite_id: "abc",
    stale: false,
    seats: { white, black },
    viewers: [],
    game: game(),
    ...over,
  };
}

function welcome(state: Snapshot, id = "p1") {
  return {
    type: "welcome",
    you: { participant_id: id, is_starter: true },
    rejoin_token: "tok",
    state,
    chat: [],
  };
}

let sockets: FakeSocket[] = [];
function sock(): FakeSocket {
  const s = sockets[0];
  if (!s) throw new Error("no socket");
  return s;
}
function renderWindow() {
  sockets = [];
  const createSocket = (url: string) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    return s;
  };
  return render(
    <MemoryRouter initialEntries={["/games/chess/s/abc"]}>
      <ShortcutsProvider>
        <Routes>
          <Route
            path="/games/chess/s/:invite"
            element={<ChessSessionWindow createSocket={createSocket} />}
          />
          <Route path="/games" element={<p>games page</p>} />
        </Routes>
      </ShortcutsProvider>
    </MemoryRouter>,
  );
}

async function joined(state: Snapshot = snap()) {
  await waitFor(() => expect(sockets.length).toBe(1));
  act(() => sock().onopen?.(new Event("open")));
  sock().receive(welcome(state));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("ChessSessionWindow", () => {
  // Spec 015 FR-12
  it("shows the invite link with a copy button on the join form and once joined", async () => {
    stub({});
    renderWindow();
    await screen.findByLabelText("Your name");
    const link = `${window.location.origin}/games/chess/s/abc`;
    expect((screen.getByLabelText("Invite link") as HTMLInputElement).value).toBe(link);
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Zed" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await joined();
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeTruthy();
  });

  // AC-3 (FR-4)
  it("asks a visitor for a name, then joins with it", async () => {
    stub({});
    renderWindow();
    const input = await screen.findByLabelText("Your name");
    expect(sockets.length).toBe(0);
    fireEvent.change(input, { target: { value: "Zed" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(sockets.length).toBe(1));
    expect(sock().url).toContain("name=Zed");
  });

  it("rejects an empty name without connecting", async () => {
    stub({});
    renderWindow();
    await screen.findByLabelText("Your name");
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(screen.getByText(/1 to 30 characters/)).toBeTruthy();
    expect(sockets.length).toBe(0);
  });

  it("does not ask a signed-in user for a name", async () => {
    stub({ signedIn: true });
    renderWindow();
    await waitFor(() => expect(sockets.length).toBe(1));
    expect(screen.queryByLabelText("Your name")).toBeNull();
    expect(sock().url).not.toContain("name=");
  });

  // AC-15 (FR-17)
  it("opens the promotion picker and sends the chosen piece with the move", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined();
    fireEvent.click(await screen.findByRole("gridcell", { name: /a7/i }));
    fireEvent.click(screen.getByRole("gridcell", { name: /a8/i }));
    const pick = await screen.findByRole("button", { name: /queen/i });
    expect(
      sock()
        .frames()
        .some((f) => f.type === "move"),
    ).toBe(false);
    fireEvent.click(pick);
    const move = sock()
      .frames()
      .find((f) => f.type === "move");
    expect(move).toMatchObject({ from: "a7", to: "a8", promotion: "q", ply: 0 });
  });

  it("sends nothing when the promotion is cancelled", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined();
    fireEvent.click(await screen.findByRole("gridcell", { name: /a7/i }));
    fireEvent.click(screen.getByRole("gridcell", { name: /a8/i }));
    await screen.findByRole("button", { name: /queen/i });
    fireEvent.keyDown(screen.getByRole("button", { name: /queen/i }), { key: "Escape" });
    expect(screen.queryByRole("button", { name: /queen/i })).toBeNull();
    expect(
      sock()
        .frames()
        .some((f) => f.type === "move"),
    ).toBe(false);
  });

  // AC-26 (FR-29)
  it("shows the stale banner and freezes the controls", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined(snap({ stale: true }));
    expect(await screen.findByText(/stale and read-only/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reactivate" })).toBeNull();
    for (const fs of document.querySelectorAll("fieldset")) expect(fs.disabled).toBe(true);
    expect(
      (screen.getByRole("textbox", { name: /message/i }) as HTMLTextAreaElement).disabled,
    ).toBe(true);
  });

  it("offers an admin Reactivate that calls the REST endpoint", async () => {
    const calls = stub({ signedIn: true, roles: ["admin"] });
    renderWindow();
    await joined(snap({ stale: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Reactivate" }));
    await waitFor(() => expect(calls).toContain("POST /api/games/chess/sessions/abc/reactivate"));
  });

  // AC-2 (FR-3): the starting position shows, inert, before the game starts
  it("shows the starting position, not playable, before the game starts", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined(snap({ game: null }));
    expect(await screen.findByRole("gridcell", { name: /e1/i })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: /e1.*king/i })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: /d8.*queen/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("gridcell", { name: /e2/i }));
    expect(screen.getByRole("gridcell", { name: /e2/i }).getAttribute("aria-selected")).not.toBe(
      "true",
    );
  });

  // AC-19, AC-25 (FR-21, FR-28): a guest who reloads rejoins with the stored token, no prompt
  it("does not ask a returning guest for a name", async () => {
    stub({ signedIn: false });
    localStorage.setItem("chess:abc", "tok");
    renderWindow();
    await joined();
    expect(screen.queryByRole("textbox", { name: /your name/i })).toBeNull();
    expect(await screen.findByRole("grid", { name: /chess board/i })).toBeTruthy();
  });

  // AC-22, AC-34 (FR-34): the result sheet is shown even though the server then deletes the session
  it("keeps the session-closed sheet when the socket then closes as deleted", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined();
    sock().receive({ type: "session_closed", result: "white", reason: "resignation" });
    sock().closeWith(4411);
    expect(await screen.findByRole("dialog", { name: "Session closed" })).toBeTruthy();
    expect(screen.queryByText("This session no longer exists")).toBeNull();
  });

  // AC-27 (FR-30)
  it("renders the chat pane beside the board", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined();
    expect(await screen.findByRole("complementary", { name: "Chat" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /message/i })).toBeTruthy();
  });

  // AC-32 (FR-32)
  it("says the session is full from the pre-join check", async () => {
    stub({ session: json(200, { invite_id: "abc", stale: false, full: true }) });
    renderWindow();
    expect(await screen.findByText("This session is full.")).toBeTruthy();
    expect(sockets.length).toBe(0);
  });

  it("says the session is full on close 4403", async () => {
    stub({ signedIn: true });
    renderWindow();
    await waitFor(() => expect(sockets.length).toBe(1));
    sock().closeWith(4403);
    expect(await screen.findByText("This session is full.")).toBeTruthy();
  });

  // AC-34 (FR-34)
  it("says the session no longer exists for 410, with a link to Games", async () => {
    stub({ session: json(410, { error: "session_deleted" }) });
    renderWindow();
    expect(await screen.findByText("This session no longer exists")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Back to Games" }));
    expect(await screen.findByText("games page")).toBeTruthy();
  });

  it("says the session no longer exists on close 4411", async () => {
    stub({ signedIn: true });
    renderWindow();
    await waitFor(() => expect(sockets.length).toBe(1));
    sock().closeWith(4411);
    expect(await screen.findByText("This session no longer exists")).toBeTruthy();
  });
});
