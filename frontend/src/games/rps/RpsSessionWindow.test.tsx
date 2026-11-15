import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsProvider } from "../../shortcuts/useShortcut";
import { RpsSessionWindow } from "./RpsSessionWindow";
import type { SocketLike } from "./rpsSocket";
import type { Recipient, RpsGame, RpsPiece, RpsState, Side } from "./rpsTypes";

// Spec 021 task 22: FR-2, FR-6, FR-13, FR-19, FR-20, FR-23 / AC-19, AC-22. Squares are
// `row * 7 + col`, row 0 on side a's edge; cell names count from the reader's side.

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
      if (url.pathname === "/api/games/rps/sessions/abc") {
        return opts.session ?? json(200, { invite_id: "abc", stale: false, full: false });
      }
      return json(404, {});
    }),
  );
  return calls;
}

const p = (square: number, side: Side, kind: RpsPiece["kind"]): RpsPiece => ({
  square,
  side,
  kind,
  revealed: false,
});

function game(over: Partial<RpsGame> = {}): RpsGame {
  return {
    status: "play",
    ready: { a: true, b: true },
    first: "a",
    turn: "a",
    ply: 0,
    pieces: [p(7, "a", "rock"), p(0, "a", "flag"), p(35, "b", null)],
    legal: { 7: [14] },
    duel: null,
    draw_offer_by: null,
    claim_available_to: null,
    result: null,
    reason: null,
    ...over,
  };
}

const ANN = { participant_id: "p1", name: "ann", signed_in: true, away: false };
const BOB = { participant_id: "p2", name: "bob", signed_in: false, away: false };
const CY = { participant_id: "p3", name: "cy", signed_in: false, away: false };

function state(over: Partial<RpsState> = {}): RpsState {
  return {
    invite_id: "abc",
    stale: false,
    seats: { a: ANN, b: BOB },
    viewers: [],
    you: "a",
    game: game(),
    ...over,
  };
}

function welcome(s: RpsState, starter = true) {
  return {
    type: "welcome",
    you: { participant_id: "p1", is_starter: starter },
    rejoin_token: "tok-1",
    state: s,
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
    <MemoryRouter initialEntries={["/games/rps/s/abc"]}>
      <ShortcutsProvider>
        <Routes>
          <Route
            path="/games/rps/s/:invite"
            element={<RpsSessionWindow createSocket={createSocket} />}
          />
          <Route path="/games" element={<p>games page</p>} />
        </Routes>
      </ShortcutsProvider>
    </MemoryRouter>,
  );
}

async function joined(s: RpsState = state(), starter = true) {
  await waitFor(() => expect(sockets.length).toBe(1));
  act(() => sock().onopen?.(new Event("open")));
  sock().receive(welcome(s, starter));
  await screen.findByRole("grid", { name: "Rock Paper Siege board" });
}

const button = (name: string | RegExp) => screen.queryByRole("button", { name });
const framesOf = (type: string) =>
  sock()
    .frames()
    .filter((f) => f.type === type);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("RpsSessionWindow: joining", () => {
  it("asks a visitor for a name, shows the invite link, then joins the rps socket", async () => {
    stub({});
    renderWindow();
    const input = await screen.findByLabelText("Your name");
    const link = `${window.location.origin}/games/rps/s/abc`;
    expect((screen.getByLabelText("Invite link") as HTMLInputElement).value).toBe(link);
    expect(sockets.length).toBe(0);
    fireEvent.change(input, { target: { value: "Zed" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(sockets.length).toBe(1));
    expect(sock().url).toContain("/api/games/rps/sessions/abc/ws");
    expect(sock().url).toContain("name=Zed");
  });

  it("stores the rejoin token under rps-rejoin:<invite> and skips the prompt with it", async () => {
    stub({});
    renderWindow();
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Zed" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await joined();
    expect(localStorage.getItem("rps-rejoin:abc")).toBe("tok-1");
    cleanup();
    renderWindow();
    await waitFor(() => expect(sockets.length).toBe(1));
    expect(screen.queryByLabelText("Your name")).toBeNull();
    expect(sock().url).toContain("rejoin=tok-1");
  });

  it("says the session no longer exists for 410, with a link to Games", async () => {
    stub({ session: json(410, { error: "session_deleted" }) });
    renderWindow();
    expect(await screen.findByText("This session no longer exists")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Games" })).toBeTruthy();
  });

  it("says the session is full on close 4403", async () => {
    stub({ signedIn: true });
    renderWindow();
    await waitFor(() => expect(sockets.length).toBe(1));
    sock().closeWith(4403);
    expect(await screen.findByText("This session is full.")).toBeTruthy();
  });
});

describe("RpsSessionWindow: controls per phase (FR-2)", () => {
  it("shows Start before the first game, enabled once both seats are taken", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined(state({ game: null }));
    const start = button("Start") as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    expect(framesOf("start")).toHaveLength(1);
    expect(button("Resign")).toBeNull();
  });

  it("disables Start with a reason while a seat is free", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined(state({ game: null, seats: { a: ANN, b: null } }));
    expect((button("Start") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Waiting for a second player")).toBeTruthy();
  });

  it("in setup: no Start, Resign available", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined(state({ game: game({ status: "setup", ready: { a: false, b: false } }) }));
    expect(button("Start")).toBeNull();
    expect(button("Resign")).toBeTruthy();
  });

  it("in play: Resign with confirmation, Offer draw, Claim win only when available", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined();
    expect(button("Start")).toBeNull();
    expect((button("Claim win") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button("Offer draw") as HTMLElement);
    expect(framesOf("offer_draw")).toHaveLength(1);
    fireEvent.click(button("Resign") as HTMLElement);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(framesOf("resign")).toHaveLength(1);
    sock().receive({ type: "state", state: state({ game: game({ claim_available_to: "a" }) }) });
    fireEvent.click(button("Claim win") as HTMLElement);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(framesOf("claim_win")).toHaveLength(1);
  });

  it("shows Start again after a game ends, with the result for everyone (FR-20)", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined(
      state({ game: game({ status: "ended", turn: null, result: "a", reason: "flag" }) }),
    );
    expect(button("Start")).toBeTruthy();
    expect(button("Resign")).toBeNull();
    expect(screen.getByText(/You won — you captured the flag/)).toBeTruthy();
  });

  it("offers Delete session to the starter only", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined();
    fireEvent.click(button("Delete session") as HTMLElement);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(framesOf("delete_session")).toHaveLength(1);
    cleanup();
    renderWindow();
    await joined(state(), false);
    expect(button("Delete session")).toBeNull();
  });

  it("keeps the session-closed sheet when the socket then closes as deleted", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined();
    sock().receive({ type: "session_closed", result: "b", reason: "resignation" });
    sock().closeWith(4411);
    const sheet = await screen.findByRole("dialog", { name: "Session closed" });
    expect(within(sheet).getByText(/You lost — you resigned/)).toBeTruthy();
    expect(screen.queryByText("This session no longer exists")).toBeNull();
  });

  it("freezes everything in a stale session", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined(state({ stale: true }));
    expect(await screen.findByText(/stale and read-only/i)).toBeTruthy();
    for (const fs of document.querySelectorAll("fieldset")) expect(fs.disabled).toBe(true);
  });
});

describe("RpsSessionWindow: draw offers (AC-19)", () => {
  const offered = (you: Recipient) =>
    state({ you, viewers: [CY], game: game({ draw_offer_by: "a", turn: "b" }) });

  it("shows Accept and Decline to the player offered a draw", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined(offered("b"));
    fireEvent.click(button("Accept") as HTMLElement);
    fireEvent.click(button("Decline") as HTMLElement);
    expect(framesOf("answer_draw")).toEqual([
      { type: "answer_draw", accept: true },
      { type: "answer_draw", accept: false },
    ]);
  });

  it("does not show them to the player who offered", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined(offered("a"));
    expect(button("Accept")).toBeNull();
    expect(button("Decline")).toBeNull();
    expect(screen.getByText("Draw offered")).toBeTruthy();
  });

  it("does not show them to a viewer", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined(offered("viewer"));
    expect(button("Accept")).toBeNull();
    expect(button("Decline")).toBeNull();
    expect(button("Offer draw")).toBeNull();
  });
});

describe("RpsSessionWindow: viewer to player (AC-22)", () => {
  it("swaps to the player layout with no viewer-only content", async () => {
    stub({ signedIn: true });
    renderWindow();
    const setup = game({ status: "setup", ready: { a: false, b: false }, pieces: [] });
    await joined(state({ you: "viewer", seats: { a: BOB, b: null }, viewers: [ANN], game: null }));
    expect(screen.getByText("You are watching.")).toBeTruthy();
    // Viewer sees the seat free between games, takes it, and the next game is set up.
    sock().receive({
      type: "state",
      state: state({ you: "viewer", seats: { a: BOB, b: CY }, viewers: [ANN], game: setup }),
    });
    expect(screen.getByText("Side A is setting up")).toBeTruthy();
    sock().receive({
      type: "state",
      state: state({ you: "a", seats: { a: ANN, b: CY }, viewers: [BOB], game: setup }),
    });
    expect(screen.queryByText("You are watching.")).toBeNull();
    expect(screen.queryByText(/is setting up/)).toBeNull();
    expect(button("Ready")).toBeTruthy();
    expect(button("Re-deal")).toBeTruthy();
  });
});

describe("RpsSessionWindow: setup, play and duel", () => {
  it("places the bar's choice on an own home square (FR-4, FR-5) and readies (FR-6)", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined(state({ game: game({ status: "setup", ready: { a: false, b: false } }) }));
    fireEvent.click(screen.getByRole("gridcell", { name: /A1$/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Trap" }));
    fireEvent.click(screen.getByRole("gridcell", { name: /G2$/ }));
    fireEvent.click(screen.getByRole("gridcell", { name: /A5$/ })); // not a home square
    expect(framesOf("place")).toEqual([
      { type: "place", what: "flag", square: 0 },
      { type: "place", what: "trap", square: 13 },
    ]);
    fireEvent.click(button("Ready") as HTMLElement);
    expect(framesOf("ready")).toHaveLength(1);
  });

  it("moves a fighter by selecting it and then a target", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined();
    fireEvent.click(screen.getByRole("gridcell", { name: /A2$/ }));
    fireEvent.click(screen.getByRole("gridcell", { name: /A3, legal target$/ }));
    expect(framesOf("move")).toEqual([{ type: "move", from: 7, to: 14 }]);
  });

  it("shows the duel picker, sends the pick, and returns focus to the board after (FR-13)", async () => {
    stub({ signedIn: true });
    renderWindow();
    const duel = {
      from: 7,
      to: 14,
      attacker: "a" as const,
      round: 1,
      picked: { a: false, b: false },
      your_pick: null,
      last_round: null,
    };
    await joined(state({ game: game({ duel, legal: {} }) }));
    const rock = screen.getByRole("button", { name: "Rock" });
    await waitFor(() => expect(document.activeElement).toBe(rock));
    fireEvent.click(rock);
    expect(framesOf("duel_pick")).toEqual([{ type: "duel_pick", weapon: "rock" }]);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    sock().receive({ type: "state", state: state({ game: game({ duel: null, turn: "b" }) }) });
    expect(screen.queryByRole("region", { name: "Duel" })).toBeNull();
    const grid = screen.getByRole("grid", { name: "Rock Paper Siege board" });
    await waitFor(() => expect(grid.contains(document.activeElement)).toBe(true));
  });

  it("announces events in one polite live region", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined();
    const live = screen.getByRole("status", { name: "Game events" });
    expect(live.getAttribute("aria-live")).toBe("polite");
    sock().receive({
      type: "state",
      state: state({ game: game({ turn: "b", pieces: [p(14, "a", "rock")] }) }),
      event: {
        kind: "fight",
        from: 7,
        to: 14,
        attacker: "rock",
        defender: "scissors",
        winner: "attacker",
      },
    });
    expect(live.textContent).toContain("Your rock beat the opponent's scissors at A3.");
  });

  it("sets --rps-board-reserve on the window for the board's height cap", async () => {
    stub({ signedIn: true });
    renderWindow();
    await joined();
    const layout = document.querySelector<HTMLElement>("[data-rps-layout]");
    expect(layout?.style.getPropertyValue("--rps-board-reserve")).toMatch(/calc\(/);
  });
});
