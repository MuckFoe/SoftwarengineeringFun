import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as encoding from "lib0/encoding";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { Hint, Me, Problem, RunResult, ServerMessage, WelcomeMessage } from "../api/types";
import type { SocketFactory, SocketLike } from "../collab/provider";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { SessionWindow } from "./SessionWindow";

// BASE is fixed when base.ts loads, so the base path is mocked; every importer of base.ts,
// the API client included, sees the value a test sets (spec 005 FR1).
const mockedBase = vi.hoisted(() => ({ value: "/" }));
vi.mock("../base", () => ({
  get BASE() {
    return mockedBase.value;
  },
  apiPath: (p: string) => `${mockedBase.value}api${p}`,
}));

class FakeSocket implements SocketLike {
  binaryType: BinaryType = "blob";
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  readonly sent: (string | BufferSource)[] = [];

  send(data: string | BufferSource) {
    this.sent.push(data);
  }

  close() {
    // Real close logic isn't needed: tests simulate server-initiated closes directly.
  }
}

function fakeSocketFactory(): {
  factory: SocketFactory;
  sockets: FakeSocket[];
  urls: string[];
} {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const factory: SocketFactory = (url) => {
    urls.push(url);
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
  return { factory, sockets, urls };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** What `GET /api/sessions/{invite}/hints` answers (spec 020); a stale window asks for it. */
const stubHints: { value: Hint[] } = { value: [] };

function stubServer(
  getResponses: Response[],
  reactivateResponse: Response = json(200, {}),
  problem?: () => Response,
  me?: Me,
) {
  const responses = [...getResponses];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const api = `${mockedBase.value}api`;
    if (me && method === "GET" && url.pathname === `${api}/me`) return json(200, me);
    if (method === "GET" && url.pathname.endsWith("/hints")) {
      return json(200, { hints: stubHints.value });
    }
    if (method === "GET" && url.pathname.startsWith(`${api}/sessions/`)) {
      return responses.shift() ?? json(404, { error: "not_found" });
    }
    if (method === "POST" && url.pathname.endsWith("/reactivate")) {
      return reactivateResponse;
    }
    if (problem && method === "GET" && url.pathname.startsWith(`${api}/problems/`)) {
      return problem();
    }
    if (method === "GET" && url.pathname === `${api}/problems`) {
      return json(200, [
        { id: "p1", title: "Sum two", is_starter: true },
        { id: "p2", title: "Reverse list", is_starter: true },
      ]);
    }
    return json(404, { error: "not_found" });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderPage(createSocket?: SocketFactory) {
  return render(
    <ShortcutsProvider>
      <MemoryRouter initialEntries={["/s/abc"]}>
        <Routes>
          <Route path="/s/:invite" element={<SessionWindow createSocket={createSocket} />} />
        </Routes>
      </MemoryRouter>
    </ShortcutsProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  mockedBase.value = "/";
  stubHints.value = [];
});

describe("SessionWindow", () => {
  it("FR-12a: an empty name, or 31 characters, is refused without connecting", async () => {
    stubServer([json(200, { state: "active" })]);
    const { factory, sockets } = fakeSocketFactory();
    renderPage(factory);
    await screen.findByLabelText("Your name");

    fireEvent.click(screen.getByRole("button", { name: /join/i }));
    await screen.findByRole("alert");
    expect(sockets).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "a".repeat(31) } });
    fireEvent.click(screen.getByRole("button", { name: /join/i }));
    await screen.findByRole("alert");
    expect(sockets).toHaveLength(0);
  });

  it("FR-12a: 30 characters connects", async () => {
    stubServer([json(200, { state: "active" })]);
    const { factory, sockets } = fakeSocketFactory();
    renderPage(factory);
    await screen.findByLabelText("Your name");

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "a".repeat(30) } });
    fireEvent.click(screen.getByRole("button", { name: /join/i }));

    expect(sockets).toHaveLength(1);
  });

  it("FR-13: close code 4403 shows a session-full message", async () => {
    stubServer([json(200, { state: "active" })]);
    const { factory, sockets } = fakeSocketFactory();
    renderPage(factory);
    await screen.findByLabelText("Your name");
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: /join/i }));
    expect(sockets).toHaveLength(1);
    const [socket] = sockets;

    socket?.onclose?.({ code: 4403 } as CloseEvent);

    await screen.findByText(/session is full/i);
  });

  it("FR-14: a 404 shows 'Session not found'", async () => {
    stubServer([json(404, { error: "not_found" })]);
    renderPage();

    await screen.findByText("Session not found");
  });
});

describe("SessionWindow, stale (spec 003 FR-12)", () => {
  it("AC-13: a stale session shows a banner under the toolbar, a read-only editor and a disabled Run", async () => {
    stubServer([json(423, { error: "stale", can_reactivate: false })]);
    const { container } = renderPage();

    const banner = (await screen.findByText(/gone stale/i)).closest("[role=status]");
    expect(banner).not.toBeNull();
    const toolbar = screen.getByRole("toolbar", { name: "Session" });
    expect(toolbar.closest(".app-header")?.nextElementSibling).toBe(banner);
    expect(within(banner as HTMLElement).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /reactivate/i })).toBeNull();
    expect((screen.getByRole("button", { name: "Run" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Check" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    const content = container.querySelector(".cm-content");
    expect(content?.getAttribute("contenteditable")).toBe("false");
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });

  it("AC-13: with can_reactivate, Reactivate is inside the banner; success clears it and shows a Hud", async () => {
    const fetchFn = stubServer([json(423, { error: "stale", can_reactivate: true })]);
    renderPage();
    const banner = (await screen.findByText(/gone stale/i)).closest("[role=status]") as HTMLElement;
    const button = within(banner).getByRole("button", { name: "Reactivate" });

    fireEvent.click(button);

    await screen.findByLabelText("Your name");
    const post = fetchFn.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post && String(post[0])).toBe("/api/sessions/abc/reactivate");
    expect(screen.queryByText(/gone stale/i)).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Session reactivated");
  });

  it("FR-3: a reactivation the server refuses keeps the banner and says so beside the button", async () => {
    stubServer([json(423, { error: "stale", can_reactivate: true })], json(500, {}));
    renderPage();
    const banner = (await screen.findByText(/gone stale/i)).closest("[role=status]") as HTMLElement;

    fireEvent.click(within(banner).getByRole("button", { name: "Reactivate" }));

    expect(await within(banner).findByText("Could not reactivate this session.")).toBeTruthy();
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });

  it("FR-9: a 409 not_stale on reactivate means it is already active, so the banner clears", async () => {
    stubServer(
      [json(423, { error: "stale", can_reactivate: true })],
      json(409, { error: "not_stale" }),
    );
    renderPage();
    const banner = (await screen.findByText(/gone stale/i)).closest("[role=status]") as HTMLElement;

    fireEvent.click(within(banner).getByRole("button", { name: "Reactivate" }));

    await screen.findByLabelText("Your name");
    expect(screen.queryByText(/gone stale/i)).toBeNull();
  });
});

const SUM_TWO: Problem = {
  id: "p1",
  title: "Sum two",
  description: "Add two integers.",
  description_html: "<p>Add two integers.</p>\n",
  signature: "def add(a: int, b: int) -> int",
  deleted: false,
};
const REVERSE_LIST: Problem = {
  id: "p2",
  title: "Reverse list",
  description: "Reverse a list.",
  description_html: "<p>Reverse a list.</p>\n",
  signature: "def reverse_list(xs: list[int]) -> list[int]",
  deleted: false,
};
const PASSED_RUN: RunResult = {
  run_id: "r1",
  problem_id: "p1",
  accepted: true,
  results: [{ position: 1, outcome: "passed" }],
};

function welcome(overrides: Partial<WelcomeMessage> = {}): WelcomeMessage {
  return {
    type: "welcome",
    participant_id: "me",
    you: { participant_id: "me", name: "Ada", signed_in: false },
    current_problem: SUM_TWO,
    problems: { p1: { accepted: false } },
    presence: [{ id: "me", name: "Ada", signed_in: false }],
    run_in_progress: false,
    chat: [],
    ...overrides,
  };
}

/** Delivers a server JSON message, as the real socket would. */
function serverSends(socket: FakeSocket, message: ServerMessage) {
  act(() => socket.onmessage?.({ data: JSON.stringify(message) } as MessageEvent));
}

/** Delivers a Yjs update holding the given code per problem. */
function serverSendsCode(socket: FakeSocket, code: Record<string, string>) {
  const remote = new Y.Doc();
  for (const [problemId, text] of Object.entries(code)) {
    remote.getText(`code:${problemId}`).insert(0, text);
  }
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0); // messageSync
  syncProtocol.writeUpdate(enc, Y.encodeStateAsUpdate(remote));
  const bytes = encoding.toUint8Array(enc);
  act(() => socket.onmessage?.({ data: bytes.buffer } as MessageEvent));
}

async function joinAsAda(): Promise<FakeSocket> {
  stubServer([json(200, { state: "active" })]);
  const { factory, sockets } = fakeSocketFactory();
  renderPage(factory);
  fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Ada" } });
  fireEvent.click(screen.getByRole("button", { name: /join/i }));
  const socket = sockets[0];
  if (!socket) throw new Error("no socket");
  act(() => socket.onopen?.(new Event("open")));
  return socket;
}

function editorText(): string {
  return document.querySelector(".cm-content")?.textContent ?? "";
}

/** Opens the unpinned sidebar's peek, as a click (or tap) on its strip does. */
function openSidebar(): void {
  fireEvent.click(screen.getByRole("button", { name: "Sidebar" }));
}

function runButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^run$/i }) as HTMLButtonElement;
}

function checkButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^check$/i }) as HTMLButtonElement;
}

describe("SessionWindow, joined", () => {
  it("FR-11: shows the invite link, before and after joining", async () => {
    stubServer([json(200, { state: "active" })]);
    renderPage(fakeSocketFactory().factory);

    const link = (await screen.findByLabelText("Invite link")) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/s/abc`);
  });

  it("spec 005 FR1: under a base path the invite link carries it", async () => {
    mockedBase.value = "/collab/";
    stubServer([json(200, { state: "active" })]);
    renderPage(fakeSocketFactory().factory);

    const link = (await screen.findByLabelText("Invite link")) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/collab/s/abc`);
  });

  it("FR-17: shows the current problem, and a switch moves the editor and the problem", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    serverSendsCode(socket, { p1: "return a + b", p2: "def reverse_list(xs): pass" });
    expect(screen.getByRole("heading", { name: "Sum two" })).toBeTruthy();
    expect(screen.getByText("Add two integers.")).toBeTruthy();
    expect(editorText()).toContain("return a + b");

    serverSends(socket, {
      type: "problem_switched",
      problem: REVERSE_LIST,
      by: "Linus",
      state: { accepted: false },
    });

    expect(screen.getByRole("heading", { name: "Reverse list" })).toBeTruthy();
    expect(editorText()).toContain("def reverse_list");
    expect(editorText()).not.toContain("return a + b");
  });

  it("FR-17: switching back restores the code and its previous results", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ current_problem: REVERSE_LIST, problems: {} }));
    serverSendsCode(socket, { p1: "return a + b" });

    serverSends(socket, {
      type: "problem_switched",
      problem: SUM_TWO,
      by: "Linus",
      state: { accepted: true, last_run: PASSED_RUN },
    });

    expect(editorText()).toContain("return a + b");
    fireEvent.click(screen.getByRole("tab", { name: "Tests" }));
    expect(screen.getByText("Test 1: passed")).toBeTruthy();
    expect(screen.getByText("Accepted")).toBeTruthy();
  });

  it("FR-28: on joining, the stored accepted status and last results are shown", async () => {
    const socket = await joinAsAda();

    serverSends(socket, welcome({ problems: { p1: { accepted: true, last_run: PASSED_RUN } } }));

    expect(screen.getByText("Accepted")).toBeTruthy();
    expect(screen.getByText("Test 1: passed")).toBeTruthy();
  });

  it("FR-23: accepted stays shown after a later failing run", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ problems: { p1: { accepted: true, last_run: PASSED_RUN } } }));

    serverSends(socket, { type: "run_started", run_id: "r2", by: "Ada" });
    serverSends(socket, {
      type: "run_finished",
      run: {
        ...PASSED_RUN,
        run_id: "r2",
        accepted: false,
        results: [{ position: 1, outcome: "wrong_answer" }],
      },
    });

    expect(screen.getByText("Test 1: wrong answer")).toBeTruthy();
    expect(screen.getByText("Accepted")).toBeTruthy();
  });

  it("FR-26: joining mid-run shows the running indicator", async () => {
    const socket = await joinAsAda();

    serverSends(socket, welcome({ run_in_progress: true }));

    expect(screen.getByText("Running…")).toBeTruthy();
    expect(checkButton().disabled).toBe(true);
  });

  it("FR-26: a failed run ends the running state and says so", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    serverSends(socket, { type: "run_started", run_id: "r1", by: "Linus" });

    serverSends(socket, { type: "run_failed", run_id: "r1", reason: "infra_error" });

    expect(screen.queryByText("Running…")).toBeNull();
    expect(checkButton().disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toMatch(/could not be completed/i);
  });

  it("FR-26: a run refused as already in progress says so", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    fireEvent.click(checkButton());

    serverSends(socket, { type: "error", code: "run_in_progress" });

    expect(screen.getByRole("alert").textContent).toMatch(/already in progress/i);
  });

  it("FR-10: joining a session on a deleted problem shows the notice and disables run", async () => {
    const socket = await joinAsAda();

    serverSends(socket, welcome({ current_problem: { ...SUM_TWO, deleted: true } }));

    expect(screen.getByText(/has been deleted/i)).toBeTruthy();
    expect(runButton().disabled).toBe(true);
    expect(checkButton().disabled).toBe(true);
  });

  it("FR-10: deletion of the current problem disables run; another problem's does not", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());

    serverSends(socket, { type: "problem_deleted", problem_id: "p-other" });
    expect(runButton().disabled).toBe(false);

    serverSends(socket, { type: "problem_deleted", problem_id: "p1" });
    expect(runButton().disabled).toBe(true);
    expect(checkButton().disabled).toBe(true);
    expect(screen.getByText(/has been deleted/i)).toBeTruthy();
  });
});

describe("SessionWindow, layout (spec 003)", () => {
  // AC-11 (component part)
  it("puts problems and participants in the sidebar, the editor in main, and Run, Invite and Appearance in the toolbar", async () => {
    const socket = await joinAsAda();
    serverSends(
      socket,
      welcome({
        presence: [
          { id: "me", name: "Ada", signed_in: false },
          { id: "l", name: "Linus", signed_in: false },
        ],
      }),
    );

    openSidebar();
    const sidebar = screen.getByRole("navigation", { name: "Sidebar" });
    expect(within(sidebar).getByRole("region", { name: "Problems" })).toBeTruthy();
    const participants = within(sidebar).getByRole("region", { name: "Participants" });
    expect(participants.textContent).toContain("Linus");
    expect(screen.getByRole("main").querySelector(".cm-content")).not.toBeNull();

    const toolbar = screen.getByRole("toolbar", { name: "Session" });
    for (const name of [/^run$/i, /^check$/i, /^invite$/i, /^appearance$/i]) {
      expect(within(toolbar).getByRole("button", { name })).toBeTruthy();
    }
    expect(within(toolbar).getByRole("heading", { name: "Sum two" })).toBeTruthy();
  });

  // Spec 016 task 20 (FR-9): live participants use LiveBadge.
  it("shows the Live badge in Participants only while someone else is in the session", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    openSidebar();
    const alone = screen.getByRole("region", { name: "Participants" });
    expect(within(alone).queryByText("Live")).toBeNull();
    serverSends(socket, {
      type: "presence",
      participants: [
        { id: "me", name: "Ada", signed_in: false },
        { id: "l", name: "Linus", signed_in: false },
      ],
    } as never);
    expect(
      within(screen.getByRole("region", { name: "Participants" })).getByText("Live"),
    ).toBeTruthy();
  });

  it("unpins the run results to a strip from their header, and pins them again from its peek", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    expect(screen.getByRole("region", { name: "Run results" })).toBeTruthy();
    const unpin = screen.getByRole("button", { name: "Unpin run results" });
    expect(unpin.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(unpin);
    expect(screen.queryByRole("region", { name: "Run results" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run results" }));
    expect(screen.getByRole("region", { name: "Run results" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pin run results" }));
    expect(screen.queryByRole("button", { name: "Run results" })).toBeNull();
    expect(localStorage.getItem("pinned.output")).toBe("true");
  });

  it("the toolbar has no panel toggles: each panel carries its own pin", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    const toolbar = screen.getByRole("toolbar", { name: "Session" });
    expect(within(toolbar).queryByRole("group", { name: "View" })).toBeNull();
    for (const name of [/sidebar/i, /run results/i, /inspector/i, /chat/i]) {
      expect(within(toolbar).queryByRole("button", { name })).toBeNull();
    }
  });

  it("checks the solution (the hidden tests) from the toolbar's Check button", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    fireEvent.click(checkButton());
    expect(socket.sent).toContain(JSON.stringify({ type: "run" }));
    expect(socket.sent).not.toContain(JSON.stringify({ type: "scratch_run", input: "" }));
  });

  it("runs the code as a script with empty input from the toolbar's Run button", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    fireEvent.click(runButton());
    expect(socket.sent).toContain(JSON.stringify({ type: "scratch_run", input: "" }));
    expect(socket.sent).not.toContain(JSON.stringify({ type: "run" }));
  });

  // AC-3: the indicator appears at once, before the server confirms the run.
  it("shows the running indicator as soon as Check is clicked, with no dialog", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    fireEvent.click(checkButton());
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    serverSends(socket, { type: "run_started", run_id: "r1", by: "Ada" });
    serverSends(socket, { type: "run_finished", run: PASSED_RUN });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("Test 1: passed")).toBeTruthy();
  });

  it("ends the indicator when the run is refused because the problem was deleted", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    fireEvent.click(checkButton());
    serverSends(socket, { type: "error", code: "problem_deleted" });
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  // AC-10 (component part)
  it("switches problems from the sidebar and has no other problem switcher", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    openSidebar();
    const reverse = await screen.findByRole("option", { name: "Reverse list" });
    fireEvent.click(reverse);
    expect(socket.sent).toContain(JSON.stringify({ type: "switch_problem", problem_id: "p2" }));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("pins the sidebar from its peek, and unpins it again", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    openSidebar();
    expect(screen.getByRole("navigation", { name: "Sidebar" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pin sidebar" }));
    expect(screen.queryByRole("button", { name: "Sidebar" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Sidebar" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unpin sidebar" }));
    expect(screen.queryByRole("navigation", { name: "Sidebar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sidebar" })).toBeTruthy();
  });
});

describe("SessionWindow, narrow width (about 390 px)", () => {
  const narrow = (matches: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: matches && query === "(max-width: 40rem)",
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));

  it("stacks the header, its controls on a second row, Run and Invite collapsing to their icons", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    const toolbar = screen.getByRole("toolbar", { name: "Session" });
    expect(toolbar.closest(".app-header")?.classList.contains("is-stacked")).toBe(true);
    for (const name of ["Run", "Check", "Invite"]) {
      const button = within(toolbar).getByRole("button", { name });
      expect(button.querySelector(".app-header-pill-text")?.textContent).toBe(name);
    }
  });

  it("starts with the sidebar closed, since there it would cover the editor", async () => {
    narrow(true);
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    expect(screen.queryByRole("navigation", { name: "Sidebar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sidebar" })).toBeTruthy();
  });

  it("starts with the description and chat unpinned, since there they would cover the editor", async () => {
    narrow(true);
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    expect(screen.getByRole("button", { name: "Description" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chat" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Description" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Chat" })).toBeNull();
  });

  it("a pin chosen earlier still wins on a narrow screen", async () => {
    narrow(true);
    localStorage.setItem("pinned.description", "true");
    localStorage.setItem("chatVisible", "shown");
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    expect(screen.getByRole("region", { name: "Description" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Chat" })).toBeTruthy();
  });

  it("starts with the description and chat pinned when wider", async () => {
    narrow(false);
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    expect(screen.getByRole("button", { name: "Unpin description" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unpin chat" })).toBeTruthy();
  });

  it("starts with the sidebar closed when wider too, so the editor gets the room", async () => {
    narrow(false);
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    expect(screen.queryByRole("navigation", { name: "Sidebar" })).toBeNull();
  });

  it("the editor's scroll area holds a tab stop, so it scrolls by keyboard (axe scrollable-region-focusable)", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    const content = document.querySelector(".cm-scroller .cm-content");
    expect(content?.getAttribute("tabindex")).toBe("0");
    expect(content?.getAttribute("contenteditable")).toBe("true");
    expect(content?.getAttribute("aria-label")).toBe("Code");
  });

  it("the stale session's read-only editor holds a tab stop too", async () => {
    stubServer([json(423, { error: "stale", can_reactivate: false })]);
    renderPage();
    await screen.findByText(/gone stale/i);
    const content = document.querySelector(".cm-scroller .cm-content");
    expect(content?.getAttribute("tabindex")).toBe("0");
    expect(content?.getAttribute("contenteditable")).toBe("false");
    expect(content?.getAttribute("aria-label")).toBe("Code");
  });
});

describe("SessionWindow, description inspector (spec 003 FR-14)", () => {
  const WITH_IMAGE: Problem = {
    ...SUM_TWO,
    description: "**Add** them\n\n![wide](/api/images/i1)",
    description_html:
      '<p><strong>Add</strong> them</p>\n<p><img src="/api/images/i1" alt="wide"></p>\n',
  };

  it("shows the server's description HTML in a Description region of the inspector, beside the editor", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ current_problem: WITH_IMAGE }));

    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    const panel = within(inspector).getByRole("region", { name: "Description" });
    expect(within(panel).getByText("Add").tagName).toBe("STRONG");
    expect(within(panel).getByRole("img", { name: "wide" }).getAttribute("src")).toBe(
      "/api/images/i1",
    );
    expect(within(screen.getByRole("main")).queryByText("them", { exact: false })).toBeNull();
    expect(document.querySelector(".cm-content")).toBeTruthy();
  });

  it("follows a problem switch", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    serverSends(socket, {
      type: "problem_switched",
      problem: REVERSE_LIST,
      by: "Linus",
      state: { accepted: false },
    });
    const panel = screen.getByRole("region", { name: "Description" });
    expect(within(panel).getByText("Reverse a list.")).toBeTruthy();
    expect(within(panel).queryByText("Add two integers.")).toBeNull();
  });

  it("unpinning the description leaves its strip, whose peek shows it again", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    fireEvent.click(screen.getByRole("button", { name: "Unpin description" }));
    expect(screen.queryByRole("region", { name: "Description" })).toBeNull();
    expect(screen.getByRole("region", { name: "Chat" })).toBeTruthy();
    const strip = screen.getByRole("button", { name: "Description" });
    act(() => strip.focus());
    // Focus alone does not open it (2026-11-12): only a press does.
    expect(strip.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(strip);
    expect(strip.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "Description" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Description" })).toBeNull();
    expect(localStorage.getItem("pinned.description")).toBe("false");
  });

  it("spec 008 FR-1: the description is above the chat, with no Description/Chat tabs", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());

    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    const description = within(inspector).getByRole("region", { name: "Description" });
    const chat = within(inspector).getByRole("region", { name: "Chat" });
    expect(
      description.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(inspector).queryByRole("tablist")).toBeNull();
    expect(within(inspector).queryByRole("tab")).toBeNull();
    expect(within(inspector).queryByRole("tabpanel")).toBeNull();
  });

  it("F4: each panel's strip has its own icon, so you can tell which is which", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    fireEvent.click(screen.getByRole("button", { name: "Unpin run results" }));
    fireEvent.click(screen.getByRole("button", { name: "Unpin description" }));
    fireEvent.click(screen.getByRole("button", { name: "Unpin chat" }));
    const icons = ["Sidebar", "Run results", "Description", "Chat"].map((name) =>
      screen.getByRole("button", { name }).querySelector(".icon")?.getAttribute("data-icon"),
    );
    expect(new Set(icons).size).toBe(4);
  });
});

describe("SessionWindow, chat pin (spec 008 FR-2, FR-3, FR-4, FR-7; 2026-11-12 pins)", () => {
  const chatRegion = () => screen.queryByRole("region", { name: "Chat" });
  const descriptionRegion = () => screen.queryByRole("region", { name: "Description" });

  it("FR-7: the chat's pin is a toggle named Unpin chat, then Pin chat; its strip has the chat icon", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());

    const unpin = screen.getByRole("button", { name: "Unpin chat" });
    expect(unpin.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(unpin);
    const strip = screen.getByRole("button", { name: "Chat" });
    expect(strip.querySelector(".icon")?.getAttribute("data-icon")).toBe("chat");
    fireEvent.click(strip);
    expect(screen.getByRole("button", { name: "Pin chat" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("FR-2: unpinning the chat keeps the description; pinning brings it back", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());

    fireEvent.click(screen.getByRole("button", { name: "Unpin chat" }));
    expect(chatRegion()).toBeNull();
    expect(descriptionRegion()).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin chat" }));
    expect(chatRegion()).toBeTruthy();
    expect(descriptionRegion()).toBeTruthy();
  });

  it("FR-4: the choice is remembered in this browser", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    fireEvent.click(screen.getByRole("button", { name: "Unpin chat" }));
    expect(localStorage.getItem("chatVisible")).toBe("hidden");
    cleanup();

    const again = await joinAsAda();
    serverSends(again, welcome());
    expect(chatRegion()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin chat" }));
    expect(localStorage.getItem("chatVisible")).toBe("shown");
  });

  it("FR-3: Ctrl+Alt+C pins an unpinned chat", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    fireEvent.click(screen.getByRole("button", { name: "Unpin chat" }));

    fireEvent.keyDown(window, { key: "c", code: "KeyC", ctrlKey: true, altKey: true });
    expect(screen.getByRole("button", { name: "Unpin chat" })).toBeTruthy();
    expect(chatRegion()).toBeTruthy();
  });

  it("both unpinned, the inspector narrows to two labelled strips", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    fireEvent.click(screen.getByRole("button", { name: "Unpin description" }));
    fireEvent.click(screen.getByRole("button", { name: "Unpin chat" }));
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    expect(within(inspector).getByRole("button", { name: "Description" })).toBeTruthy();
    expect(within(inspector).getByRole("button", { name: "Chat" })).toBeTruthy();
    expect(descriptionRegion()).toBeNull();
    expect(chatRegion()).toBeNull();
  });
});

describe("SessionWindow, chat inspector (spec 003 FR-15)", () => {
  const HISTORY = [
    {
      id: 1,
      sender_name: "Ben",
      participant_id: "p",
      signed_in: false,
      text: "hello there",
      sent_at: "2026-10-25T10:00:00Z",
    },
    {
      id: 2,
      sender_name: "Ben",
      participant_id: "p",
      signed_in: false,
      text: "try a hashmap",
      sent_at: "2026-10-25T10:01:00Z",
    },
  ];
  const chatPanel = () => screen.getByRole("region", { name: "Chat" });

  it("the Chat region shows the welcome's history and new messages, and sends over the socket", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ chat: HISTORY }));

    expect(within(chatPanel()).getByText("try a hashmap")).toBeTruthy();

    serverSends(socket, {
      type: "chat_message",
      message: {
        id: 3,
        sender_name: "Ana",
        participant_id: "p",
        signed_in: false,
        text: "on it",
        sent_at: "2026-10-25T10:02:00Z",
      },
      client_id: "someone-else",
    });
    expect(within(chatPanel()).getByText("on it")).toBeTruthy();

    fireEvent.change(within(chatPanel()).getByLabelText("Message"), { target: { value: "ok" } });
    fireEvent.click(within(chatPanel()).getByRole("button", { name: "Send" }));
    const sent = socket.sent.map((m) => (typeof m === "string" ? JSON.parse(m) : null));
    expect(sent).toContainEqual(expect.objectContaining({ type: "chat_send", text: "ok" }));
  });

  it("Ctrl+Alt+C unpins the chat, leaving it peeking until Escape, and pins it again", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ chat: HISTORY }));
    const press = () =>
      fireEvent.keyDown(window, { key: "c", code: "KeyC", ctrlKey: true, altKey: true });

    expect(within(chatPanel()).getByText("hello there")).toBeTruthy();
    press();
    const strip = screen.getByRole("button", { name: "Chat" });
    expect(strip.getAttribute("aria-expanded")).toBe("true");
    expect(within(chatPanel()).getByText("hello there")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Chat" })).toBeNull();
    expect(screen.getByRole("region", { name: "Description" })).toBeTruthy();
    press();
    expect(screen.getByRole("button", { name: "Unpin chat" })).toBeTruthy();
    expect(within(chatPanel()).getByText("hello there")).toBeTruthy();
  });

  it("a stale session shows the chat history read-only, with the reason", async () => {
    stubServer([
      json(423, { error: "stale", can_reactivate: false }),
      json(200, { messages: HISTORY, read_only: true }),
    ]);
    renderPage(fakeSocketFactory().factory);
    await screen.findByText(/gone stale/i);

    expect(await within(chatPanel()).findByText("try a hashmap")).toBeTruthy();
    const input = within(chatPanel()).getByLabelText("Message") as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    expect(within(chatPanel()).getByText(/can't be sent/i)).toBeTruthy();
  });

  const STALE = { error: "stale", can_reactivate: false, problem_id: "p1" };
  const staleWithDescription = () =>
    stubServer(
      [json(423, STALE), json(200, { messages: HISTORY, read_only: true })],
      json(200, {}),
      () => json(200, SUM_TWO),
    );

  it("spec 008 FR-9: a stale session shows its description above the read-only chat", async () => {
    const fetchFn = staleWithDescription();
    renderPage(fakeSocketFactory().factory);
    await screen.findByText(/gone stale/i);

    const description = await screen.findByRole("region", { name: "Description" });
    expect(within(description).getByText("Add two integers.")).toBeTruthy();
    expect(fetchFn.mock.calls.some(([input]) => String(input).endsWith("/api/problems/p1"))).toBe(
      true,
    );
    const chat = chatPanel();
    // Description comes first in document order, the chat below it.
    expect(description.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(await within(chat).findByText("try a hashmap")).toBeTruthy();
    const input = within(chat).getByLabelText("Message") as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
  });

  it("spec 008 FR-9: if the description can't be loaded, the stale chat is shown alone", async () => {
    stubServer(
      [json(423, STALE), json(200, { messages: HISTORY, read_only: true })],
      json(200, {}),
      () => json(500, {}),
    );
    renderPage(fakeSocketFactory().factory);
    await screen.findByText(/gone stale/i);

    expect(await within(chatPanel()).findByText("try a hashmap")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Description" })).toBeNull();
  });

  it("spec 008 FR-2: the stale session unpins and pins the chat from its own pin; no toolbar toggles", async () => {
    staleWithDescription();
    renderPage(fakeSocketFactory().factory);
    await screen.findByRole("region", { name: "Description" });
    const toolbar = screen.getByRole("toolbar", { name: "Session" });
    expect(within(toolbar).queryByRole("button", { name: /inspector|chat/i })).toBeNull();

    const unpin = screen.getByRole("button", { name: "Unpin chat" });
    expect(unpin.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(unpin);
    expect(screen.queryByRole("region", { name: "Chat" })).toBeNull();
    expect(screen.getByRole("region", { name: "Description" })).toBeTruthy();
    expect(localStorage.getItem("chatVisible")).toBe("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin chat" }));
    expect(chatPanel()).toBeTruthy();
    expect(localStorage.getItem("chatVisible")).toBe("shown");
  });

  it("spec 008 FR-4: a remembered unpinned chat starts as a strip in a stale session; its peek shows it", async () => {
    localStorage.setItem("chatVisible", "hidden");
    staleWithDescription();
    renderPage(fakeSocketFactory().factory);
    await screen.findByRole("region", { name: "Description" });

    expect(screen.queryByRole("region", { name: "Chat" })).toBeNull();
    const strip = screen.getByRole("button", { name: "Chat" });
    expect(strip.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(strip);
    expect(await within(chatPanel()).findByText("try a hashmap")).toBeTruthy();
  });

  const GIF_MESSAGE = {
    id: 3,
    sender_name: "Ben",
    participant_id: "p",
    signed_in: false,
    sent_at: "2026-10-25T10:02:00Z",
    kind: "gif" as const,
    gif: {
      id: "g1",
      title: "party parrot",
      url: "https://media.giphy.com/g1.gif",
      still_url: "https://media.giphy.com/g1_s.gif",
      width: 200,
      height: 150,
    },
  };

  it("spec 007 FR-1: an active session's chat offers a GIF button", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ chat: HISTORY }));

    expect(within(chatPanel()).getByRole("button", { name: "GIF" })).toBeTruthy();
  });

  it("spec 007 FR-8: a stale session shows GIF messages and no GIF button", async () => {
    stubServer([
      json(423, { error: "stale", can_reactivate: false }),
      json(200, { messages: [...HISTORY, GIF_MESSAGE], read_only: true }),
    ]);
    renderPage(fakeSocketFactory().factory);
    await screen.findByText(/gone stale/i);

    expect(await within(chatPanel()).findByRole("img", { name: "party parrot" })).toBeTruthy();
    expect(within(chatPanel()).queryByRole("button", { name: "GIF" })).toBeNull();
  });
});

// jsdom isn't macOS, so these are the Windows/Linux keys; the macOS ones run end to end.
describe("SessionWindow, shortcuts (spec 003 FR-17)", () => {
  const press = (init: KeyboardEventInit) => fireEvent.keyDown(window, init);
  const RUN = { key: "Enter", ctrlKey: true };
  const CHECK = { key: "Enter", ctrlKey: true, shiftKey: true };
  const checks = (socket: FakeSocket) =>
    socket.sent.filter((m) => m === JSON.stringify({ type: "run" })).length;
  const runs = (socket: FakeSocket) =>
    socket.sent.filter((m) => m === JSON.stringify({ type: "scratch_run", input: "" })).length;

  it("AC-18: Ctrl+Enter runs the code as a script, also from inside the editor", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());

    fireEvent.keyDown(document.querySelector(".cm-content") as Element, RUN);

    expect(runs(socket)).toBe(1);
    expect(checks(socket)).toBe(0);
  });

  it("Ctrl+Shift+Enter checks the solution, also from inside the editor", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());

    fireEvent.keyDown(document.querySelector(".cm-content") as Element, CHECK);

    expect(checks(socket)).toBe(1);
    expect(runs(socket)).toBe(0);
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0);
  });

  it("the check shortcut does nothing while a check is going or the problem is deleted", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ run_in_progress: true }));
    press(CHECK);
    expect(checks(socket)).toBe(0);

    serverSends(socket, welcome({ current_problem: { ...SUM_TWO, deleted: true } }));
    press(CHECK);
    expect(checks(socket)).toBe(0);
  });

  it("the run shortcut does nothing while a script run is going or the problem is deleted", async () => {
    const socket = await joinAsAda();
    serverSends(
      socket,
      welcome({
        scratch_run: {
          status: "running",
          started_by: "A",
          started_at: "2026-01-01T00:00:00Z",
          input: "",
          output: [],
          seq: 0,
          exit_code: null,
        },
      }),
    );
    press(RUN);
    expect(runs(socket)).toBe(0);

    serverSends(
      socket,
      welcome({ scratch_run: null, current_problem: { ...SUM_TWO, deleted: true } }),
    );
    press(RUN);
    expect(runs(socket)).toBe(0);
  });

  it("Ctrl+Alt+R unpins the run results (left peeking until Escape) and pins them again", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    press({ key: "r", code: "KeyR", ctrlKey: true, altKey: true });
    expect(screen.getByRole("button", { name: "Run results" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Run results" })).toBeNull();
    press({ key: "r", code: "KeyR", ctrlKey: true, altKey: true });
    expect(screen.getByRole("button", { name: "Unpin run results" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Run results" })).toBeTruthy();
  });

  it("Ctrl+Alt+S pins the sidebar, and unpins it again", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    expect(screen.queryByRole("navigation", { name: "Sidebar" })).toBeNull();
    press({ key: "s", code: "KeyS", ctrlKey: true, altKey: true });
    expect(screen.getByRole("button", { name: "Unpin sidebar" })).toBeTruthy();
    press({ key: "s", code: "KeyS", ctrlKey: true, altKey: true });
    expect(screen.getByRole("button", { name: "Sidebar" })).toBeTruthy();
  });

  it("Ctrl+Alt+PageDown / PageUp switch to the next and previous problem, sidebar closed or open", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    // Open the sidebar only to wait for the problem list, then close it: the shortcuts still work.
    openSidebar();
    await screen.findByRole("option", { name: "Reverse list" });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("navigation", { name: "Sidebar" })).toBeNull();
    const switches = () => socket.sent.filter((m) => String(m).includes("switch_problem"));

    press({ key: "PageUp", ctrlKey: true, altKey: true });
    expect(switches()).toEqual([]);

    press({ key: "PageDown", ctrlKey: true, altKey: true });
    expect(switches()).toEqual([JSON.stringify({ type: "switch_problem", problem_id: "p2" })]);

    serverSends(socket, {
      type: "problem_switched",
      problem: REVERSE_LIST,
      state: { accepted: false },
      by: "Ada",
    });
    press({ key: "PageDown", ctrlKey: true, altKey: true });
    expect(switches()).toHaveLength(1);
    press({ key: "PageUp", ctrlKey: true, altKey: true });
    expect(switches().at(-1)).toBe(JSON.stringify({ type: "switch_problem", problem_id: "p1" }));
  });

  it("Ctrl+Alt+I copies the invite link and confirms it with a HUD", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const socket = await joinAsAda();
    serverSends(socket, welcome());

    press({ key: "i", code: "KeyI", ctrlKey: true, altKey: true });

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/abc`);
    expect(await screen.findByText("Invite link copied")).toBeTruthy();
  });

  it("none of the session shortcuts act while the session is stale", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const fetchFn = stubServer([json(423, { error: "stale", can_reactivate: true })]);
    renderPage();
    await screen.findByText(/gone stale/i);
    const calls = fetchFn.mock.calls.length;

    press(RUN);
    press(CHECK);
    press({ key: "r", code: "KeyR", ctrlKey: true, altKey: true });
    press({ key: "PageDown", ctrlKey: true, altKey: true });
    press({ key: "i", code: "KeyI", ctrlKey: true, altKey: true });

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByText("Invite link copied")).toBeNull();
    expect(fetchFn.mock.calls.length).toBe(calls);
    expect(screen.getByText(/gone stale/i)).toBeTruthy();
  });
});

const NEWUSER: Me = { signed_in: true, name: "newuser", roles: [], preferences: null };
const ANONYMOUS: Me = { signed_in: false, roles: [] };

describe("SessionWindow, accounts (spec 012)", () => {
  it("FR-1: signed in, opening /s/:invite shows no name sheet and connects without a name", async () => {
    stubServer([json(200, { state: "active" })], undefined, undefined, NEWUSER);
    const { factory, sockets, urls } = fakeSocketFactory();
    renderPage(factory);

    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(urls[0]).toMatch(/\/api\/sessions\/abc\/ws$/);
    expect(screen.queryByLabelText("Your name")).toBeNull();
    const socket = sockets[0] as FakeSocket;
    act(() => socket.onopen?.(new Event("open")));
    serverSends(
      socket,
      welcome({
        you: { participant_id: "me", name: "newuser", signed_in: true },
        presence: [{ id: "me", name: "newuser", signed_in: true }],
      }),
    );
    await screen.findByRole("heading", { name: "Sum two" });
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });

  it("AC-13 + FR-1: a signed-in admin who reactivates joins at once and still sees the Hud", async () => {
    const ADMIN: Me = { signed_in: true, name: "admin1", roles: ["admin"], preferences: null };
    stubServer([json(423, { error: "stale", can_reactivate: true })], undefined, undefined, ADMIN);
    const { factory, sockets } = fakeSocketFactory();
    renderPage(factory);
    const banner = (await screen.findByText(/gone stale/i)).closest("[role=status]") as HTMLElement;

    fireEvent.click(within(banner).getByRole("button", { name: "Reactivate" }));

    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0] as FakeSocket;
    act(() => socket.onopen?.(new Event("open")));
    serverSends(
      socket,
      welcome({
        you: { participant_id: "me", name: "admin1", signed_in: true },
        presence: [{ id: "me", name: "admin1", signed_in: true }],
      }),
    );
    await screen.findByRole("heading", { name: "Sum two" });
    expect(screen.getByText("Session reactivated").getAttribute("role")).toBe("status");
  });

  it("FR-6: not signed in, the name sheet is shown as today and nothing connects", async () => {
    stubServer([json(200, { state: "active" })], undefined, undefined, ANONYMOUS);
    const { factory, sockets, urls } = fakeSocketFactory();
    renderPage(factory);

    await screen.findByLabelText("Your name");
    expect(sockets).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: /join/i }));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\?name=Ada$/);
  });

  it("FR-5: a 4409 close says it was opened elsewhere, does not reconnect, and Use here reconnects", async () => {
    stubServer([json(200, { state: "active" })], undefined, undefined, NEWUSER);
    const { factory, sockets, urls } = fakeSocketFactory();
    renderPage(factory);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0] as FakeSocket;
    act(() => socket.onopen?.(new Event("open")));
    serverSends(
      socket,
      welcome({ you: { participant_id: "me", name: "newuser", signed_in: true } }),
    );
    await screen.findByRole("heading", { name: "Sum two" });

    act(() => socket.onclose?.({ code: 4409 } as CloseEvent));

    await screen.findByText("This session was opened in another tab or window.");
    expect(screen.queryByLabelText("Your name")).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(sockets).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Use here" }));
    expect(sockets).toHaveLength(2);
    expect(urls[1]).toMatch(/\/api\/sessions\/abc\/ws$/);
    const again = sockets[1] as FakeSocket;
    act(() => again.onopen?.(new Event("open")));
    serverSends(
      again,
      welcome({ you: { participant_id: "me", name: "newuser", signed_in: true } }),
    );
    await screen.findByRole("heading", { name: "Sum two" });
  });
});

describe("SessionWindow, Run output and Check tabs (spec 011, 2026-11-12 change)", () => {
  const RUN = {
    status: "finished" as const,
    started_by: "A",
    started_at: "2026-01-01T00:00:00Z",
    input: "3",
    output: [{ s: "out" as const, t: "9" }],
    seq: 1,
    exit_code: 0,
  };
  const results = () => screen.getByRole("region", { name: "Run results" });
  const tab = (name: string) => within(results()).getByRole("tab", { name });
  const selected = () =>
    within(results())
      .getAllByRole("tab")
      .filter((t) => t.getAttribute("aria-selected") === "true")
      .map((t) => t.textContent);
  const output = () => within(results()).getByRole("tabpanel", { name: "Output" });

  it("the results panel has Output and Tests tabs, and no input box", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    expect(within(results()).getByRole("tablist").textContent).toBe("OutputTests");
    expect(selected()).toEqual(["Output"]);
    expect(within(results()).queryByLabelText("Input")).toBeNull();
    expect(screen.queryByRole("button", { name: /own-input/ })).toBeNull();
  });

  it("FR-10: a welcome's script run shows its output, status and starter", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ scratch_run: RUN }));
    expect(within(output()).getByTestId("scratch-output").textContent).toBe("9");
    expect(within(output()).getByRole("status").textContent).toMatch(/finished.*started by A/);
  });

  it("FR-5: a started run and its output show as they arrive, errors included", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ scratch_run: null }));
    serverSends(socket, {
      type: "scratch_run_started",
      run: { ...RUN, input: "", status: "running", output: [], seq: 0, exit_code: null },
    });
    serverSends(socket, { type: "scratch_run_output", seq: 0, s: "out", t: "hi\n" });
    serverSends(socket, { type: "scratch_run_output", seq: 3, s: "err", t: "ValueError: x\n" });
    expect(within(output()).getByTestId("scratch-output").textContent).toContain("hi");
    expect(within(output()).getByTestId("scratch-output").textContent).toContain("ValueError: x");
    expect(within(output()).getByRole("status").textContent).toMatch(/running/);
    serverSends(socket, { type: "scratch_run_end", status: "error", exit_code: 1 });
    expect(within(output()).getByRole("status").textContent).toMatch(/error/);
  });

  it("Run disables itself until the run ends", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ scratch_run: null }));
    fireEvent.click(runButton());
    expect(runButton().disabled).toBe(true);
    serverSends(socket, {
      type: "scratch_run_started",
      run: { ...RUN, input: "", status: "running", output: [], seq: 0, exit_code: null },
    });
    expect(runButton().disabled).toBe(true);
    serverSends(socket, { type: "scratch_run_end", status: "finished", exit_code: 0 });
    expect(runButton().disabled).toBe(false);
  });

  it("Run and Check are disabled for a deleted problem", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ current_problem: { ...SUM_TWO, deleted: true } }));
    expect(runButton().disabled).toBe(true);
    expect(checkButton().disabled).toBe(true);
  });

  it("starting Run selects Output; starting Check selects Tests", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    fireEvent.click(checkButton());
    expect(selected()).toEqual(["Tests"]);
    fireEvent.click(runButton());
    expect(selected()).toEqual(["Output"]);
  });

  it("a run or check started by someone else switches the tab too", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    serverSends(socket, { type: "run_started", run_id: "r1", by: "Linus" });
    expect(selected()).toEqual(["Tests"]);
    serverSends(socket, {
      type: "scratch_run_started",
      run: { ...RUN, started_by: "Linus", status: "running", output: [], seq: 0, exit_code: null },
    });
    expect(selected()).toEqual(["Output"]);
  });

  it("a join opens on Tests when a check is going or the problem has results and no script run", async () => {
    let socket = await joinAsAda();
    serverSends(socket, welcome({ problems: { p1: { accepted: true, last_run: PASSED_RUN } } }));
    expect(selected()).toEqual(["Tests"]);
    cleanup();
    socket = await joinAsAda();
    serverSends(
      socket,
      welcome({ scratch_run: RUN, problems: { p1: { accepted: true, last_run: PASSED_RUN } } }),
    );
    expect(selected()).toEqual(["Output"]);
  });

  it("the tabs switch by click", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    fireEvent.click(tab("Tests"));
    expect(selected()).toEqual(["Tests"]);
    expect(within(results()).queryByTestId("scratch-output")).toBeNull();
    fireEvent.click(tab("Output"));
    expect(selected()).toEqual(["Output"]);
  });

  it("starting Run or Check peeks unpinned results, without pinning them", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    fireEvent.click(screen.getByRole("button", { name: "Unpin run results" }));
    expect(screen.queryByRole("region", { name: "Run results" })).toBeNull();
    fireEvent.click(runButton());
    expect(screen.getByRole("region", { name: "Run results" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pin run results" })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("region", { name: "Run results" })).toBeNull();
    fireEvent.click(checkButton());
    expect(screen.getByRole("region", { name: "Run results" })).toBeTruthy();
    expect(localStorage.getItem("pinned.output")).toBe("false");
  });

  it("FR-9: a refusal as in progress names who started the run", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    serverSends(socket, { type: "scratch_run_refused", reason: "in_progress", by: "A" });
    expect(within(output()).getByRole("alert").textContent).toContain("A");
  });

  it("a gap in the output re-joins to fetch a fresh welcome", async () => {
    const { factory, sockets } = fakeSocketFactory();
    stubServer([json(200, { state: "active" })]);
    renderPage(factory);
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: /join/i }));
    act(() => sockets[0]?.onopen?.(new Event("open")));
    serverSends(sockets[0] as FakeSocket, welcome({ scratch_run: { ...RUN, status: "running" } }));
    serverSends(sockets[0] as FakeSocket, {
      type: "scratch_run_output",
      seq: 50,
      s: "out",
      t: "x",
    });
    expect(sockets).toHaveLength(2);
    act(() => sockets[1]?.onopen?.(new Event("open")));
    serverSends(sockets[1] as FakeSocket, welcome({ scratch_run: RUN }));
    expect(within(output()).getByTestId("scratch-output").textContent).toBe("9");
  });

  it("FR-12: a stale session has Run and Check, both disabled, and no output tabs", async () => {
    stubServer([json(423, { error: "stale", can_reactivate: false })]);
    renderPage();
    await screen.findByText(/gone stale/);
    expect(runButton().disabled).toBe(true);
    expect(checkButton().disabled).toBe(true);
    expect(screen.queryByRole("tabpanel", { name: "Output" })).toBeNull();
  });
});

describe("SessionWindow, deleted (spec 019 FR-7, FR-8)", () => {
  it("AC-7: a 410 session_deleted shows that the session was deleted, with a link home", async () => {
    stubServer([json(410, { error: "session_deleted" })]);
    renderPage();

    expect(await screen.findByRole("heading", { name: "This session was deleted" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
    expect(screen.queryByText("Session not found")).toBeNull();
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });

  it("AC-6: session_deleted by the host, then close 4411, shows the deleted state", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    await screen.findByRole("heading", { name: "Sum two" });

    act(() =>
      socket.onmessage?.({
        data: JSON.stringify({ type: "session_deleted", by: "host" }),
      } as MessageEvent),
    );
    act(() => socket.onclose?.({ code: 4411 } as CloseEvent));

    expect(await screen.findByRole("heading", { name: "This session was deleted" })).toBeTruthy();
    expect(screen.getByText("The host deleted it.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to home" })).toBeTruthy();
    expect(screen.queryByText(/disconnected/i)).toBeNull();
  });

  it("a close 4411 without the message still shows the deleted state", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    await screen.findByRole("heading", { name: "Sum two" });

    act(() => socket.onclose?.({ code: 4411 } as CloseEvent));

    await screen.findByRole("heading", { name: "This session was deleted" });
    expect(screen.queryByText(/deleted it\./)).toBeNull();
  });
});

describe("SessionWindow, hints (spec 020)", () => {
  const hint = (over: Partial<Hint> = {}): Hint => ({
    id: "h1",
    problem_id: "p1",
    number: 1,
    asked_by: "Ben",
    note: null,
    body: "Think about what you have already seen.",
    created_at: "2026-11-12T10:00:00Z",
    ...over,
  });
  const description = () => screen.getByRole("region", { name: "Description" });
  const hintButton = () => within(description()).queryByRole("button", { name: "Hint" });
  const hintHeadings = () =>
    within(description())
      .queryAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
  /** Visible text only: the polite live region repeats some lines as announcements. */
  const VISIBLE = { selector: ":not([role=status])" };
  const sentJson = (socket: FakeSocket) =>
    socket.sent.filter((m): m is string => typeof m === "string").map((m) => JSON.parse(m));

  it("AC-1: hints_enabled shows Hint in the Description section", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ hints_enabled: true }));
    expect(hintButton()).toBeTruthy();
  });

  it("AC-1: hints_enabled false, or absent from an older server, shows no Hint", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    expect(hintButton()).toBeNull();
    serverSends(socket, welcome({ hints_enabled: false }));
    expect(hintButton()).toBeNull();
  });

  it("AC-2: a deleted current problem shows no Hint, and its hints stay listed", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ hints_enabled: true, hints: [hint()] }));
    serverSends(socket, { type: "problem_deleted", problem_id: "p1" });
    expect(hintButton()).toBeNull();
    expect(hintHeadings()).toEqual(["Hint 1"]);
  });

  it("AC-2: a stale session shows its problem's hints from getHints, read-only", async () => {
    stubHints.value = [
      hint({ id: "h2", number: 2, body: "Second." }),
      hint(),
      hint({ id: "hx", problem_id: "p2", body: "Other problem." }),
    ];
    const fetchFn = stubServer(
      [json(423, { error: "stale", can_reactivate: false, problem_id: "p1" })],
      json(200, {}),
      () => json(200, SUM_TWO),
    );
    renderPage(fakeSocketFactory().factory);
    await screen.findByText(/gone stale/i);

    await within(await screen.findByRole("region", { name: "Description" })).findByText("Second.");
    expect(hintHeadings()).toEqual(["Hint 1", "Hint 2"]);
    expect(screen.queryByText("Other problem.")).toBeNull();
    expect(hintButton()).toBeNull();
    expect(
      fetchFn.mock.calls.some(([input]) => String(input).endsWith("/api/sessions/abc/hints")),
    ).toBe(true);
  });

  it("AC-3/AC-6: asking sends hint_request with the note; hint_started shows who asked; hint_ready shows the hint", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ hints_enabled: true }));

    fireEvent.click(hintButton() as HTMLElement);
    fireEvent.change(within(description()).getByLabelText("What are you stuck on? (optional)"), {
      target: { value: "stuck on empty input" },
    });
    fireEvent.click(within(description()).getByRole("button", { name: "Ask" }));
    expect(sentJson(socket)).toContainEqual({
      type: "hint_request",
      note: "stuck on empty input",
    });

    serverSends(socket, {
      type: "hint_started",
      pending: { problem_id: "p1", by: "Ada", note: "stuck on empty input", warming: false },
    });
    expect(within(description()).getByText("Preparing hint…")).toBeTruthy();
    expect(within(description()).getByText(/Asked by Ada/)).toBeTruthy();
    expect((hintButton() as HTMLButtonElement).disabled).toBe(true);

    serverSends(socket, {
      type: "hint_ready",
      hint: hint({ asked_by: "Ada", note: "stuck on empty input" }),
    });
    expect(within(description()).queryByText("Preparing hint…")).toBeNull();
    expect(hintHeadings()).toEqual(["Hint 1"]);
    expect(within(description()).getByText("Model hint")).toBeTruthy();
    expect((hintButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("AC-6: hint_refused in_progress shows that a hint is already being prepared", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ hints_enabled: true }));
    serverSends(socket, { type: "hint_refused", reason: "in_progress", by: "Ben" });
    expect(
      within(description()).getByText("A hint is already being prepared", VISIBLE),
    ).toBeTruthy();
  });

  it("FR-8: a late joiner sees the welcome's pending hint", async () => {
    const socket = await joinAsAda();
    serverSends(
      socket,
      welcome({
        hints_enabled: true,
        hint_pending: { problem_id: "p1", by: "Ben", note: null, warming: true },
      }),
    );
    expect(
      within(description()).getByText("Model is warming up. This hint takes longer.", VISIBLE),
    ).toBeTruthy();
    expect((hintButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("AC-11: only the current problem's hints are shown; a switch shows the other problem's", async () => {
    const socket = await joinAsAda();
    serverSends(
      socket,
      welcome({
        hints_enabled: true,
        hints: [
          hint(),
          hint({ id: "h2", number: 2, body: "A two." }),
          hint({ id: "h3", problem_id: "p2", body: "B one." }),
        ],
      }),
    );
    expect(hintHeadings()).toEqual(["Hint 1", "Hint 2"]);
    expect(within(description()).queryByText("B one.")).toBeNull();

    serverSends(socket, {
      type: "problem_switched",
      problem: REVERSE_LIST,
      by: "Ben",
      state: { accepted: false },
    });
    expect(hintHeadings()).toEqual(["Hint 1"]);
    expect(within(description()).getByText("B one.")).toBeTruthy();
  });

  it("problem_switched clears the hint notice", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ hints_enabled: true }));
    serverSends(socket, { type: "hint_failed", problem_id: "p1", reason: "unavailable" });
    expect(
      within(description()).getByText("Hints are unavailable right now", VISIBLE),
    ).toBeTruthy();
    serverSends(socket, {
      type: "problem_switched",
      problem: REVERSE_LIST,
      by: "Ben",
      state: { accepted: false },
    });
    expect(
      within(description()).queryByText("Hints are unavailable right now", VISIBLE),
    ).toBeNull();
  });

  it("AC-12: hint_failed shows the matching notice and re-enables Hint; hint_started clears it", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ hints_enabled: true }));
    const started = () =>
      serverSends(socket, {
        type: "hint_started",
        pending: { problem_id: "p1", by: "Ben", note: null, warming: false },
      });

    started();
    serverSends(socket, { type: "hint_failed", problem_id: "p1", reason: "unavailable" });
    expect(
      within(description()).getByText("Hints are unavailable right now", VISIBLE),
    ).toBeTruthy();
    expect(within(description()).queryByText("Preparing hint…")).toBeNull();
    expect((hintButton() as HTMLButtonElement).disabled).toBe(false);

    started();
    expect(
      within(description()).queryByText("Hints are unavailable right now", VISIBLE),
    ).toBeNull();
    serverSends(socket, { type: "hint_failed", problem_id: "p1", reason: "withheld" });
    expect(
      within(description()).getByText("No hint could be given this time", VISIBLE),
    ).toBeTruthy();
  });

  it("AC-12a: hint_warming switches the pending line to warming up", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome({ hints_enabled: true }));
    serverSends(socket, {
      type: "hint_started",
      pending: { problem_id: "p1", by: "Ben", note: null, warming: false },
    });
    serverSends(socket, { type: "hint_warming", problem_id: "p1" });
    expect(
      within(description()).getByText("Model is warming up. This hint takes longer.", VISIBLE),
    ).toBeTruthy();
    expect(within(description()).queryByText("Preparing hint…")).toBeNull();
  });
});
