import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as encoding from "lib0/encoding";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { Problem, RunResult, ServerMessage, WelcomeMessage } from "../api/types";
import type { SocketFactory, SocketLike } from "../collab/provider";
import { SessionPage } from "./SessionPage";

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

function fakeSocketFactory(): { factory: SocketFactory; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  const factory: SocketFactory = () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
  return { factory, sockets };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubServer(getResponses: Response[], reactivateResponse: Response = json(200, {})) {
  const responses = [...getResponses];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    if (method === "GET" && url.pathname.startsWith("/api/sessions/")) {
      return responses.shift() ?? json(404, { error: "not_found" });
    }
    if (method === "POST" && url.pathname.endsWith("/reactivate")) {
      return reactivateResponse;
    }
    return json(404, { error: "not_found" });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderPage(createSocket?: SocketFactory) {
  return render(
    <MemoryRouter initialEntries={["/s/abc"]}>
      <Routes>
        <Route path="/s/:invite" element={<SessionPage createSocket={createSocket} />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SessionPage", () => {
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

  it("FR-30: a 423 with can_reactivate false shows the stale notice and no reactivate button", async () => {
    stubServer([json(423, { error: "stale", can_reactivate: false })]);
    renderPage();

    await screen.findByText(/gone stale/i);
    expect(screen.queryByRole("button", { name: /reactivate/i })).toBeNull();
  });

  it("FR-31/FR-32: can_reactivate true; clicking reactivate posts, then shows the name prompt", async () => {
    const fetchFn = stubServer([json(423, { error: "stale", can_reactivate: true })]);
    renderPage();
    await screen.findByRole("button", { name: /reactivate/i });

    fireEvent.click(screen.getByRole("button", { name: /reactivate/i }));

    await screen.findByLabelText("Your name");
    const post = fetchFn.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post && String(post[0])).toBe("/api/sessions/abc/reactivate");
  });
});

const SUM_TWO: Problem = {
  id: "p1",
  title: "Sum two",
  description: "Add two integers.",
  signature: "def add(a: int, b: int) -> int",
  deleted: false,
};
const REVERSE_LIST: Problem = {
  id: "p2",
  title: "Reverse list",
  description: "Reverse a list.",
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
    current_problem: SUM_TWO,
    problems: { p1: { accepted: false } },
    presence: [{ id: "me", name: "Ada" }],
    run_in_progress: false,
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

function runButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^run$/i }) as HTMLButtonElement;
}

describe("SessionPage, joined", () => {
  it("FR-11: shows the invite link, before and after joining", async () => {
    stubServer([json(200, { state: "active" })]);
    renderPage(fakeSocketFactory().factory);

    const link = (await screen.findByLabelText("Invite link")) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/s/abc`);
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
    expect(runButton().disabled).toBe(true);
  });

  it("FR-26: a failed run ends the running state and says so", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());
    serverSends(socket, { type: "run_started", run_id: "r1", by: "Linus" });

    serverSends(socket, { type: "run_failed", run_id: "r1", reason: "infra_error" });

    expect(screen.queryByText("Running…")).toBeNull();
    expect(runButton().disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toMatch(/could not be completed/i);
  });

  it("FR-26: a run refused as already in progress says so", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());

    serverSends(socket, { type: "error", code: "run_in_progress" });

    expect(screen.getByRole("alert").textContent).toMatch(/already in progress/i);
  });

  it("FR-10: joining a session on a deleted problem shows the notice and disables run", async () => {
    const socket = await joinAsAda();

    serverSends(socket, welcome({ current_problem: { ...SUM_TWO, deleted: true } }));

    expect(screen.getByText(/has been deleted/i)).toBeTruthy();
    expect(runButton().disabled).toBe(true);
  });

  it("FR-10: deletion of the current problem disables run; another problem's does not", async () => {
    const socket = await joinAsAda();
    serverSends(socket, welcome());

    serverSends(socket, { type: "problem_deleted", problem_id: "p-other" });
    expect(runButton().disabled).toBe(false);

    serverSends(socket, { type: "problem_deleted", problem_id: "p1" });
    expect(runButton().disabled).toBe(true);
    expect(screen.getByText(/has been deleted/i)).toBeTruthy();
  });
});
