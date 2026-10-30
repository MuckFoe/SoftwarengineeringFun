import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, Me, Participant } from "../api/types";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { LearningSessionWindow } from "./LearningSessionWindow";
import type { SocketFactory, SocketLike } from "./learnSocket";
import type {
  LearningRecord,
  LearnServerMessage,
  LessonOutline,
  StepView,
  Summary,
} from "./learnTypes";

// The backend is not part of this unit: fetch and the WebSocket are stubbed at the boundary,
// following plan.md's REST and WebSocket contracts.

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

  receive(message: LearnServerMessage) {
    act(() => this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent));
  }

  closeWith(code: number) {
    act(() => this.onclose?.({ code } as CloseEvent));
  }

  messages() {
    return this.sent.map((s) => JSON.parse(s) as { type: string });
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

const LESSON: LessonOutline = {
  key: "01-docker/01-basics",
  title: "Docker basics",
  topic: "Docker",
  steps: [
    { position: 0, title: "Images and containers", kind: "explanation" },
    { position: 1, title: "Which runs?", kind: "quiz" },
    { position: 2, title: "Name it", kind: "quiz" },
    { position: 3, title: "List containers", kind: "terminal" },
  ],
};

const PASSED = { by: "Ada", at: "2026-10-29T10:00:00Z", after_reveal: false };

function step(position: number, extra: Partial<StepView> = {}): StepView {
  const outline = LESSON.steps[position];
  if (!outline) throw new Error(`no step ${position}`);
  return {
    position,
    title: outline.title,
    kind: outline.kind,
    body_html: `<p>Body of ${outline.title}</p>`,
    check: null,
    has_hint: false,
    hint_html: null,
    show_answer_available: false,
    answer: null,
    attempts: [],
    passed: null,
    ...extra,
  };
}

/** Steps 1 and 2 (positions 0, 1) passed; the group is on step 3 (position 2). */
function activeRecord(): LearningRecord {
  return {
    lesson: LESSON,
    current_step: 2,
    completed: false,
    stale: false,
    summary: null,
    steps: [
      step(0, { passed: PASSED }),
      step(1, {
        check: { type: "choice", options: ["An image", "A container"], multiple: false },
        answer: { type: "choice", correct: [1] },
        attempts: [
          {
            id: 1,
            by: "Bob",
            kind: "choice",
            submitted: [0],
            correct: false,
            output: null,
            at: "2026-10-29T10:01:00Z",
          },
          {
            id: 2,
            by: "Ada",
            kind: "choice",
            submitted: [1],
            correct: true,
            output: null,
            at: "2026-10-29T10:02:00Z",
          },
        ],
        passed: PASSED,
      }),
      step(2, { check: { type: "text" } }),
    ],
  };
}

const SUMMARY: Summary = {
  steps: LESSON.steps.map((s) => ({
    position: s.position,
    title: s.title,
    attempts: 1,
    passed_by: "Ada",
    after_reveal: false,
  })),
};

function completedRecord(): LearningRecord {
  return {
    lesson: LESSON,
    current_step: 4,
    completed: true,
    stale: false,
    summary: SUMMARY,
    steps: [
      step(0, { passed: PASSED }),
      step(1, { check: { type: "text" }, passed: PASSED, answer: { type: "text", accept: ["x"] } }),
      step(2, { check: { type: "text" }, passed: PASSED, answer: { type: "text", accept: ["y"] } }),
      step(3, {
        check: { type: "terminal", prompt: "$ " },
        passed: PASSED,
        answer: { type: "terminal", command: "docker ps", output: "" },
      }),
    ],
  };
}

const PEOPLE: Participant[] = [
  { id: "p1", name: "Ada" },
  { id: "p2", name: "Bob" },
];

const CHAT: ChatMessage[] = [
  { id: 7, sender_name: "Ada", text: "see you", sent_at: "2026-09-01T10:00:00Z" },
];

const VISITOR: Me = { signed_in: false, roles: [] };

interface ServerOptions {
  state?: { status: number; body: unknown };
  record?: LearningRecord;
  reactivate?: { status: number; body: unknown };
}

function stubServer({
  state = { status: 200, body: { state: "active" } },
  record = activeRecord(),
  reactivate = { status: 200, body: {} },
}: ServerOptions = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    const path = url.pathname;
    if (path === "/api/me") return json(VISITOR);
    if (method === "GET" && path === "/api/learn/sessions/abc") {
      return json(state.body, state.status);
    }
    if (method === "GET" && path === "/api/learn/sessions/abc/record") return json(record);
    if (method === "GET" && path === "/api/learn/sessions/abc/chat") {
      return json({ messages: CHAT, read_only: true });
    }
    if (method === "POST" && path === "/api/learn/sessions/abc/reactivate") {
      return json(reactivate.body, reactivate.status);
    }
    return json({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderPage(createSocket?: SocketFactory) {
  return render(
    <ShortcutsProvider>
      <MemoryRouter initialEntries={["/learn/s/abc"]}>
        <Routes>
          <Route
            path="/learn/s/:invite"
            element={<LearningSessionWindow createSocket={createSocket} />}
          />
        </Routes>
      </MemoryRouter>
    </ShortcutsProvider>,
  );
}

async function joinAs(name: string, sockets: FakeSocket[]) {
  fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /join/i }));
  const socket = sockets[sockets.length - 1];
  if (!socket) throw new Error("no socket opened");
  return socket;
}

async function joinWith(record: LearningRecord) {
  const { factory, sockets } = fakeSockets();
  renderPage(factory);
  const socket = await joinAs("Ada", sockets);
  socket.open();
  socket.receive({ type: "welcome", you: { participant_id: "p1" }, record, chat: CHAT });
  socket.receive({ type: "presence", participants: PEOPLE });
  return socket;
}

function stepList() {
  return screen.getByRole("list", { name: "Steps" });
}

function stepButton(n: number) {
  return within(stepList()).getByRole("button", { name: new RegExp(`^${n}\\. `) });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LearningSessionWindow: joining (FR-7, FR-8)", () => {
  it("AC-7: an empty name or 31 characters is refused without connecting", async () => {
    stubServer();
    const { factory, sockets } = fakeSockets();
    renderPage(factory);
    await screen.findByLabelText("Your name");

    fireEvent.click(screen.getByRole("button", { name: /join/i }));
    expect((await screen.findByText(/1 to 30 characters/)).textContent).toBeTruthy();
    expect(sockets).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "a".repeat(31) } });
    fireEvent.click(screen.getByRole("button", { name: /join/i }));
    expect(screen.getByText(/1 to 30 characters/)).toBeTruthy();
    expect(sockets).toHaveLength(0);
  });

  it("AC-7: 30 characters connects to the learning socket with the trimmed name", async () => {
    stubServer();
    const { factory, sockets } = fakeSockets();
    renderPage(factory);
    const socket = await joinAs(`  ${"a".repeat(30)} `, sockets);
    expect(sockets).toHaveLength(1);
    expect(socket.url).toContain("/api/learn/sessions/abc/ws?name=");
    expect(socket.url).toContain(`name=${"a".repeat(30)}`);
  });

  it("AC-7: a name the server refuses (4422) shows the invalid-name message", async () => {
    stubServer();
    const { factory, sockets } = fakeSockets();
    renderPage(factory);
    const socket = await joinAs("Ada", sockets);
    socket.closeWith(4422);
    expect(await screen.findByText(/name was refused/i)).toBeTruthy();
    expect(screen.getByLabelText("Your name")).toBeTruthy();
  });

  it("AC-8: a full session (4403) says it is full", async () => {
    stubServer();
    const { factory, sockets } = fakeSockets();
    renderPage(factory);
    const socket = await joinAs("Ada", sockets);
    socket.closeWith(4403);
    expect(await screen.findByText(/session is full/i)).toBeTruthy();
  });

  it("an unknown invite (404) shows not found", async () => {
    stubServer({ state: { status: 404, body: { error: "not_found" } } });
    renderPage(fakeSockets().factory);
    expect(await screen.findByText(/session not found/i)).toBeTruthy();
  });

  it("a 4404 close says the session was not found", async () => {
    stubServer();
    const { factory, sockets } = fakeSockets();
    renderPage(factory);
    const socket = await joinAs("Ada", sockets);
    socket.closeWith(4404);
    expect(await screen.findByText(/session not found/i)).toBeTruthy();
  });
});

describe("LearningSessionWindow: joined (FR-9, FR-10, FR-15)", () => {
  it("AC-9: after welcome, the current step, passed steps and participants show", async () => {
    stubServer();
    await joinWith(activeRecord());

    expect(screen.getByRole("heading", { name: "Name it" })).toBeTruthy();
    expect(stepButton(3).getAttribute("aria-current")).toBe("step");
    expect(stepButton(1).textContent).toMatch(/passed/i);
    expect(stepButton(2).textContent).toMatch(/passed/i);
    expect(stepButton(3).textContent).not.toMatch(/passed/i);
    expect((stepButton(4) as HTMLButtonElement).disabled).toBe(true);

    const people = screen.getByRole("list", { name: "Participants" });
    expect(within(people).getByText("Ada")).toBeTruthy();
    expect(within(people).getByText("Bob")).toBeTruthy();
  });

  it("the current step can be submitted over the socket", async () => {
    stubServer();
    const socket = await joinWith(activeRecord());
    fireEvent.change(screen.getByRole("textbox", { name: "Answer" }), {
      target: { value: "container" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(socket.messages()).toContainEqual({ type: "submit_text", step: 2, text: "container" });
  });

  it("AC-14: opening passed step 2 shows content, answer and attempts; nothing submits; current stays 3", async () => {
    stubServer();
    const socket = await joinWith(activeRecord());

    fireEvent.click(stepButton(2));

    expect(screen.getByRole("heading", { name: "Which runs?" })).toBeTruthy();
    expect(screen.getByText("Body of Which runs?")).toBeTruthy();
    const answer = screen.getByRole("region", { name: "Answer" });
    expect(within(answer).getByText("A container")).toBeTruthy();
    const attempts = screen.getByRole("list", { name: "Attempts" });
    expect(within(attempts).getAllByRole("listitem")).toHaveLength(2);

    const submit = screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    for (const radio of screen.getAllByRole("radio") as HTMLInputElement[]) {
      expect(radio.disabled).toBe(true);
    }
    fireEvent.click(submit);
    expect(socket.messages().filter((m) => m.type !== "chat_send")).toEqual([]);

    expect(stepButton(3).getAttribute("aria-current")).toBe("step");
    expect(stepButton(2).getAttribute("aria-current")).toBeNull();

    // Back to the current step, which can be answered again.
    fireEvent.click(stepButton(3));
    expect(screen.getByRole("heading", { name: "Name it" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Answer" }) as HTMLInputElement).disabled).toBe(
      false,
    );
  });

  it("FR-10: a step_passed from the server moves everyone's current step", async () => {
    stubServer();
    const socket = await joinWith(activeRecord());
    socket.receive({
      type: "step_passed",
      step: 2,
      passed: { by: "Bob", at: "2026-10-29T10:05:00Z", after_reveal: false },
      answer: { type: "text", accept: ["container"] },
      next: step(3, { check: { type: "terminal", prompt: "$ " } }),
    });
    expect(screen.getByRole("heading", { name: "List containers" })).toBeTruthy();
    expect(stepButton(4).getAttribute("aria-current")).toBe("step");
    expect(stepButton(3).textContent).toMatch(/passed/i);
  });

  it("chat goes over the learning socket", async () => {
    stubServer();
    const socket = await joinWith(activeRecord());
    const chat = screen.getByRole("complementary", { name: "Chat" });
    expect(within(chat).getByText("see you")).toBeTruthy();
    fireEvent.change(within(chat).getByRole("textbox"), { target: { value: "hello" } });
    fireEvent.submit(within(chat).getByRole("textbox").closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(socket.messages()).toContainEqual(
        expect.objectContaining({ type: "chat_send", text: "hello" }),
      ),
    );
  });
});

describe("LearningSessionWindow: completed and stale (FR-24, FR-26, FR-27)", () => {
  it("AC-25: a completed session shows every step passed, the summary, and nothing submits", async () => {
    stubServer({ state: { status: 200, body: { state: "completed" } } });
    const socket = await joinWith(completedRecord());

    expect(screen.getByRole("table", { name: "Completion summary" })).toBeTruthy();
    for (const n of [1, 2, 3, 4]) {
      expect(stepButton(n).textContent).toMatch(/passed/i);
      expect(stepButton(n).getAttribute("aria-current")).toBeNull();
    }

    fireEvent.click(stepButton(3));
    expect(screen.getByRole("heading", { name: "Name it" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Answer" }) as HTMLInputElement).disabled).toBe(
      true,
    );
    fireEvent.click(stepButton(1));
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(socket.messages()).toEqual([]);
  });

  it("FR-24: the completed message shows the summary to everyone", async () => {
    stubServer();
    const socket = await joinWith(activeRecord());
    expect(screen.queryByRole("table", { name: "Completion summary" })).toBeNull();
    socket.receive({ type: "completed", summary: SUMMARY });
    expect(screen.getByRole("table", { name: "Completion summary" })).toBeTruthy();
  });

  it("AC-26: a stale session (423) shows its record and chat read-only, without Reactivate for non-admins", async () => {
    const fetchFn = stubServer({
      state: { status: 423, body: { error: "stale", can_reactivate: false } },
    });
    const { factory, sockets } = fakeSockets();
    renderPage(factory);

    expect(await screen.findByText(/gone stale/i)).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Name it" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reactivate" })).toBeNull();
    expect(screen.queryByLabelText("Your name")).toBeNull();
    expect(sockets).toHaveLength(0);

    expect((screen.getByRole("textbox", { name: "Answer" }) as HTMLInputElement).disabled).toBe(
      true,
    );
    fireEvent.click(stepButton(2));
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    const chat = screen.getByRole("complementary", { name: "Chat" });
    expect(await within(chat).findByText("see you")).toBeTruthy();
    expect((within(chat).getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);

    const paths = fetchFn.mock.calls.map((c) => new URL(String(c[0]), "http://localhost").pathname);
    expect(paths).toContain("/api/learn/sessions/abc/record");
    expect(paths).toContain("/api/learn/sessions/abc/chat");
  });

  it("AC-26: an admin sees Reactivate; reactivating offers the join prompt again", async () => {
    const fetchFn = stubServer({
      state: { status: 423, body: { error: "stale", can_reactivate: true } },
    });
    renderPage(fakeSockets().factory);

    fireEvent.click(await screen.findByRole("button", { name: "Reactivate" }));

    expect(await screen.findByLabelText("Your name")).toBeTruthy();
    expect(screen.queryByText(/gone stale/i)).toBeNull();
    const post = fetchFn.mock.calls.find((c) => c[1]?.method === "POST");
    expect(post && new URL(String(post[0]), "http://localhost").pathname).toBe(
      "/api/learn/sessions/abc/reactivate",
    );
  });

  it("AC-26: a 409 not_stale on reactivate means it is already active", async () => {
    stubServer({
      state: { status: 423, body: { error: "stale", can_reactivate: true } },
      reactivate: { status: 409, body: { error: "not_stale" } },
    });
    renderPage(fakeSockets().factory);
    fireEvent.click(await screen.findByRole("button", { name: "Reactivate" }));
    expect(await screen.findByLabelText("Your name")).toBeTruthy();
  });

  it("a failed reactivate keeps the session stale and says so", async () => {
    stubServer({
      state: { status: 423, body: { error: "stale", can_reactivate: true } },
      reactivate: { status: 500, body: {} },
    });
    renderPage(fakeSockets().factory);
    fireEvent.click(await screen.findByRole("button", { name: "Reactivate" }));
    expect(await screen.findByText("Could not reactivate this session.")).toBeTruthy();
    expect(screen.getByText(/gone stale/i)).toBeTruthy();
  });
});
