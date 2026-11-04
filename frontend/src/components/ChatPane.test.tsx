import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, GifResult } from "../api/types";
import { markNoticeSeen } from "../chat/gifs/gifNotice";
import { useChat } from "../chat/useChat";
import { CollabProvider, type SocketLike } from "../collab/provider";
import { ChatPane } from "./ChatPane";

const at = (time: string) => `2026-10-25T${time}:00Z`;

const MESSAGES: ChatMessage[] = [
  {
    id: 1,
    sender_name: "Ana",
    participant_id: "p",
    signed_in: false,
    text: "one",
    sent_at: at("10:00"),
  },
  {
    id: 2,
    sender_name: "Ana",
    participant_id: "p",
    signed_in: false,
    text: "two",
    sent_at: at("10:03"),
  },
  {
    id: 3,
    sender_name: "Ben",
    participant_id: "p",
    signed_in: false,
    text: "three",
    sent_at: at("10:04"),
  },
  // More than 5 minutes after Ben's last: a new header.
  {
    id: 4,
    sender_name: "Ben",
    participant_id: "p",
    signed_in: false,
    text: "four",
    sent_at: at("10:10"),
  },
  {
    id: 5,
    sender_name: "Ana",
    participant_id: "p",
    signed_in: false,
    text: "five",
    sent_at: at("10:11"),
  },
];

function renderPane(props: Partial<Parameters<typeof ChatPane>[0]> = {}) {
  const send = vi.fn(async () => "ok" as const);
  render(<ChatPane messages={MESSAGES} readOnly={false} send={send} {...props} />);
  return { send };
}

const input = () => screen.getByLabelText("Message") as HTMLTextAreaElement;

afterEach(cleanup);

describe("ChatPane (spec 003 FR-15)", () => {
  it("consecutive messages from one sender within 5 minutes share a header", () => {
    renderPane();
    const groups = within(screen.getByRole("list", { name: "Messages" })).getAllByRole("listitem");
    expect(groups.map((g) => within(g).getByRole("heading").textContent)).toEqual([
      expect.stringContaining("Ana"),
      expect.stringContaining("Ben"),
      expect.stringContaining("Ben"),
      expect.stringContaining("Ana"),
    ]);
    expect(within(groups[0] as HTMLElement).getByText("one")).toBeTruthy();
    expect(within(groups[0] as HTMLElement).getByText("two")).toBeTruthy();
    expect(
      within(groups[0] as HTMLElement)
        .getByRole("heading")
        .querySelector("time")?.dateTime,
    ).toBe(at("10:00"));
  });

  it("shows the character count against the 2000 limit while typing", () => {
    renderPane();
    expect(screen.getByText("0/2000")).toBeTruthy();
    fireEvent.change(input(), { target: { value: "hello" } });
    expect(screen.getByText("5/2000")).toBeTruthy();
  });

  it("Return sends and clears the input; Shift+Return does not send", async () => {
    const { send } = renderPane();
    fireEvent.change(input(), { target: { value: "try a hashmap" } });
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(send).not.toHaveBeenCalled();

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(send).toHaveBeenCalledWith("try a hashmap");
    await waitFor(() => expect(input().value).toBe(""));
  });

  it("a refused message states the limit and keeps the text", async () => {
    const send = vi.fn(async () => "chat_too_long" as const);
    renderPane({ send });
    const long = "a".repeat(2001);
    fireEvent.change(input(), { target: { value: long } });
    expect(screen.getByText("2001/2000")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/2000 characters/)).toBeTruthy();
    expect(input().value).toBe(long);
  });

  it("a send that fails to reach the session keeps the text", async () => {
    const send = vi.fn(async () => {
      throw new Error("disconnected");
    });
    renderPane({ send });
    fireEvent.change(input(), { target: { value: "hello" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(await screen.findByText(/couldn't be sent/i)).toBeTruthy();
    expect(input().value).toBe("hello");
  });

  it("read-only: history shown, the input disabled with its reason", () => {
    const { send } = renderPane({ readOnly: true });
    expect(screen.getByText("five")).toBeTruthy();
    expect(input().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    const reason = screen.getByText(/stale/i);
    expect((input().getAttribute("aria-describedby") ?? "").split(" ")).toContain(
      reason.closest("[id]")?.id,
    );
    expect(send).not.toHaveBeenCalled();
  });

  // Spec 002 FR15
  it("shows a message's markup as exactly the characters sent", () => {
    const text = "<script>alert(1)</script> **bold** <b>x</b>";
    renderPane({
      messages: [
        {
          id: 1,
          sender_name: "Ana",
          participant_id: "p",
          signed_in: false,
          text,
          sent_at: at("10:00"),
        },
      ],
    });
    const list = screen.getByRole("list", { name: "Messages" });
    const body = within(list).getByText(text);
    expect(body.textContent).toBe(text);
    expect(list.querySelector("script, b, strong")).toBeNull();
  });

  // Spec 002 FR19
  it("an admin has Remove on each message, naming its sender and time, and it removes that message", async () => {
    const remove = vi.fn(async () => undefined);
    renderPane({ canRemove: true, remove });
    const buttons = screen.getAllByRole("button", { name: /^Remove message from/ });
    expect(buttons).toHaveLength(MESSAGES.length);

    const time = new Date(at("10:04")).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    fireEvent.click(screen.getByRole("button", { name: `Remove message from Ben at ${time}` }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(3));
  });

  it("a removal that fails says so", async () => {
    const remove = vi.fn(async () => {
      throw new Error("forbidden");
    });
    renderPane({ canRemove: true, remove });
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Remove message from/ })[0] as HTMLElement,
    );
    expect(await screen.findByText(/couldn't be removed/i)).toBeTruthy();
  });

  it("without the admin role there is no Remove", () => {
    renderPane({ canRemove: false });
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  });
});

describe("ChatPane scrolling (F3)", () => {
  /** jsdom has no layout: give the message list a 100 px window onto `content` px. */
  function sized(list: HTMLElement, content: number) {
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: content });
  }
  const more = (n: number): ChatMessage[] => [
    ...MESSAGES,
    {
      id: 5 + n,
      sender_name: "Ben",
      participant_id: "p",
      signed_in: false,
      text: `new ${n}`,
      sent_at: at("10:20"),
    },
  ];
  const send = async () => "ok" as const;

  it("a new message scrolls the list to the end when you were reading the end", () => {
    const { rerender } = render(<ChatPane messages={MESSAGES} readOnly={false} send={send} />);
    const list = screen.getByRole("list", { name: "Messages" });
    sized(list, 500);

    rerender(<ChatPane messages={more(1)} readOnly={false} send={send} />);
    expect(list.scrollTop).toBe(500);
  });

  it("leaves the list where it is when you have scrolled back to older messages", () => {
    const { rerender } = render(<ChatPane messages={MESSAGES} readOnly={false} send={send} />);
    const list = screen.getByRole("list", { name: "Messages" });
    sized(list, 500);
    list.scrollTop = 50;
    fireEvent.scroll(list);

    rerender(<ChatPane messages={more(1)} readOnly={false} send={send} />);
    expect(list.scrollTop).toBe(50);
  });

  it("spec 008 FR-3: shown again after being hidden, the list scrolls to its newest message", () => {
    const { rerender } = render(<ChatPane messages={MESSAGES} readOnly={false} send={send} />);
    const list = screen.getByRole("list", { name: "Messages" });
    sized(list, 500);
    rerender(<ChatPane messages={MESSAGES} readOnly={false} send={send} visible={false} />);
    // While hidden the list was scrolled away from the end (e.g. collapsed, or read back).
    list.scrollTop = 0;
    fireEvent.scroll(list);
    rerender(<ChatPane messages={more(1)} readOnly={false} send={send} visible={false} />);
    expect(list.scrollTop).toBe(0);

    rerender(<ChatPane messages={more(1)} readOnly={false} send={send} visible />);
    expect(list.scrollTop).toBe(500);
  });

  it("spec 008 FR-3: staying shown does not move a list scrolled back to older messages", () => {
    const { rerender } = render(
      <ChatPane messages={MESSAGES} readOnly={false} send={send} visible />,
    );
    const list = screen.getByRole("list", { name: "Messages" });
    sized(list, 500);
    list.scrollTop = 50;
    fireEvent.scroll(list);
    rerender(<ChatPane messages={MESSAGES} readOnly={false} send={send} visible />);
    expect(list.scrollTop).toBe(50);
  });

  it("the input is outside the scrolling list, after it", () => {
    render(<ChatPane messages={MESSAGES} readOnly={false} send={send} />);
    const list = screen.getByRole("list", { name: "Messages" });
    expect(list.contains(input())).toBe(false);
    expect(list.compareDocumentPosition(input()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/** The browser WebSocket boundary (001's seam): records what the client sends. */
class FakeSocket implements SocketLike {
  binaryType: BinaryType = "blob";
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  sentText: string[] = [];

  send(data: string | BufferSource) {
    if (typeof data === "string") this.sentText.push(data);
  }

  close() {}

  lastSearchId(): string {
    const searches = this.sentText.map((t) => JSON.parse(t)).filter((m) => m.type === "gif_search");
    const last = searches[searches.length - 1];
    if (!last) throw new Error("no gif_search sent");
    return last.request_id;
  }

  serverSends(message: unknown) {
    act(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) })));
  }
}

describe("ChatPane GIFs (spec 007)", () => {
  const INVITE = "inv1";
  const gif = (id: string, title = id): GifResult => ({
    id,
    title,
    url: `https://media.example/${id}.gif`,
    still_url: `https://media.example/${id}_s.gif`,
    width: 200,
    height: 150,
  });
  const GIF_MESSAGES: ChatMessage[] = [
    {
      id: 1,
      sender_name: "Ana",
      participant_id: "p",
      signed_in: false,
      text: "before",
      sent_at: at("10:00"),
    },
    {
      id: 2,
      sender_name: "Ben",
      participant_id: "p",
      signed_in: false,
      kind: "gif",
      gif: gif("g1", "Happy dance"),
      sent_at: at("10:01"),
    },
    {
      id: 3,
      sender_name: "Cy",
      participant_id: "p",
      signed_in: false,
      kind: "gif",
      gif: gif("g2", ""),
      sent_at: at("10:02"),
    },
    {
      id: 4,
      sender_name: "Ana",
      participant_id: "p",
      signed_in: false,
      text: "after",
      sent_at: at("10:03"),
    },
  ];

  function connect() {
    let socket: FakeSocket | undefined;
    const provider = new CollabProvider({
      inviteId: INVITE,
      name: "Ada",
      createSocket: () => {
        socket = new FakeSocket();
        return socket;
      },
    });
    if (!socket) throw new Error("no socket");
    const s = socket;
    act(() => s.onopen?.(new Event("open")));
    return { provider, socket: s };
  }

  function renderWithGifs(props: Partial<Parameters<typeof ChatPane>[0]> = {}) {
    const { provider, socket } = connect();
    const sendGif = vi.fn(async () => "ok" as const);
    render(
      <ChatPane
        messages={GIF_MESSAGES}
        readOnly={false}
        send={async () => "ok"}
        gifs={{ invite: INVITE, provider, sendGif }}
        {...props}
      />,
    );
    return { socket, sendGif };
  }

  const gifButton = () => screen.queryByRole("button", { name: "GIF" });
  const rowOf = (text: string) => screen.getByText(text).closest("li") as HTMLElement;

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("FR-3: Enter on a result calls sendGif(id), closes the picker and returns focus to the GIF button", async () => {
    markNoticeSeen(INVITE);
    const { socket, sendGif } = renderWithGifs();
    const button = gifButton() as HTMLElement;
    fireEvent.click(button);
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
    socket.serverSends({
      type: "gif_results",
      request_id: socket.lastSearchId(),
      trending: true,
      results: [gif("t1", "One"), gif("t2", "Two")],
    });

    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    await act(async () => fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" }));

    expect(sendGif).toHaveBeenCalledWith("t1");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("NFR-6: Escape closes the picker and returns focus to the GIF button", () => {
    renderWithGifs();
    const button = gifButton() as HTMLElement;
    fireEvent.click(button);
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(document.activeElement).toBe(cont);
    fireEvent.keyDown(cont, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("NFR-3: a refused GIF post says to wait", async () => {
    markNoticeSeen(INVITE);
    const { provider, socket } = connect();
    const sendGif = vi.fn(async () => "gif_rate_limited" as const);
    render(
      <ChatPane
        messages={GIF_MESSAGES}
        readOnly={false}
        send={async () => "ok"}
        gifs={{ invite: INVITE, provider, sendGif }}
      />,
    );
    fireEvent.click(gifButton() as HTMLElement);
    socket.serverSends({
      type: "gif_results",
      request_id: socket.lastSearchId(),
      trending: true,
      results: [gif("t1", "One")],
    });
    await act(async () => fireEvent.click(screen.getByRole("option")));

    expect(sendGif).toHaveBeenCalledWith("t1");
    expect(await screen.findByText(/wait/i)).toBeTruthy();
  });

  it("FR-8: read-only shows GIF messages and no GIF button", () => {
    renderWithGifs({ readOnly: true });
    expect(screen.getByRole("img", { name: "Happy dance" })).toBeTruthy();
    expect(gifButton()).toBeNull();
  });

  it("without GIF props (Learn chat, 006) there is no GIF button", () => {
    render(<ChatPane messages={GIF_MESSAGES} readOnly={false} send={async () => "ok"} />);
    expect(gifButton()).toBeNull();
    expect(screen.getByRole("img", { name: "Happy dance" })).toBeTruthy();
  });

  it("FR-10: a GIF row's image is named by its title, or 'GIF'", () => {
    renderWithGifs();
    expect(within(rowOf("Ben")).getByRole("img", { name: "Happy dance" })).toBeTruthy();
    expect(within(rowOf("Cy")).getByRole("img", { name: "GIF" })).toBeTruthy();
  });

  it("FR-11: a GIF row shows 'via GIPHY'", () => {
    renderWithGifs();
    expect(within(rowOf("Ben")).getByText("via GIPHY")).toBeTruthy();
    expect(within(rowOf("Cy")).getByText("via GIPHY")).toBeTruthy();
    expect(within(rowOf("before")).queryByText("via GIPHY")).toBeNull();
  });

  it("FR-12: a GIF that fails to load shows the placeholder, keeping sender, time and position", () => {
    renderWithGifs();
    fireEvent.error(screen.getByRole("img", { name: "Happy dance" }));

    const groups = within(screen.getByRole("list", { name: "Messages" })).getAllByRole("listitem");
    expect(groups.map((g) => within(g).getByRole("heading").textContent)).toEqual([
      expect.stringContaining("Ana"),
      expect.stringContaining("Ben"),
      expect.stringContaining("Cy"),
      expect.stringContaining("Ana"),
    ]);
    const ben = groups[1] as HTMLElement;
    expect(within(ben).getByText("GIF no longer available")).toBeTruthy();
    expect(ben.querySelector("time")?.dateTime).toBe(at("10:01"));
    expect(within(groups[0] as HTMLElement).getByText("before")).toBeTruthy();
    expect(within(groups[3] as HTMLElement).getByText("after")).toBeTruthy();
  });

  it("FR-7: an admin sees Remove on a GIF row and it calls the remove handler", async () => {
    const remove = vi.fn(async () => undefined);
    renderWithGifs({ canRemove: true, remove });
    const time = new Date(at("10:01")).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    fireEvent.click(screen.getByRole("button", { name: `Remove message from Ben at ${time}` }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(2));
  });
});

describe("ChatPane: own messages and the signed-in mark (spec 012)", () => {
  const INVITE = "inv1";
  const text = (
    id: number,
    sender_name: string,
    participant_id: string,
    signed_in: boolean,
    time: string,
  ): ChatMessage => ({
    id,
    sender_name,
    participant_id,
    signed_in,
    text: `m${id}`,
    sent_at: at(time),
  });

  // Only the HTTP boundary (/api/me) and the WebSocket are stubbed; useChat runs for real.
  function Harness({ provider }: { provider: CollabProvider }) {
    const chat = useChat({ invite: INVITE, provider, stale: false });
    return <ChatPane messages={chat.messages} readOnly={false} send={chat.send} />;
  }

  function join(welcomeExtra: Record<string, unknown>, chat: ChatMessage[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ signed_in: false, roles: [] }))),
    );
    let socket: FakeSocket | undefined;
    const provider = new CollabProvider({
      inviteId: INVITE,
      name: "newuser",
      createSocket: () => {
        socket = new FakeSocket();
        return socket;
      },
    });
    render(<Harness provider={provider} />);
    if (!socket) throw new Error("no socket");
    const s = socket;
    act(() => s.onopen?.(new Event("open")));
    s.serverSends({
      type: "welcome",
      current_problem: {
        id: "q1",
        title: "Add",
        description: "d",
        description_html: "<p>d</p>\n",
        signature: "def add(a: int, b: int) -> int",
        deleted: false,
      },
      problems: {},
      presence: [],
      run_in_progress: false,
      chat,
      ...welcomeExtra,
    });
  }

  const groups = () =>
    within(screen.getByRole("list", { name: "Messages" })).getAllByRole("listitem");
  const groupOf = (body: string) => screen.getByText(body).closest("li") as HTMLElement;
  const senderOf = (body: string) =>
    within(groupOf(body)).getByRole("heading").querySelector("[data-sender]")?.textContent;

  afterEach(() => vi.unstubAllGlobals());

  it("FR-3: a history message whose participant_id matches welcome.you is shown as yours; a same-named other's is not", () => {
    join(
      { participant_id: "me", you: { participant_id: "me", name: "newuser", signed_in: true } },
      [text(1, "newuser", "me", true, "10:00"), text(2, "newuser", "other", false, "10:01")],
    );
    expect(groups()).toHaveLength(2);
    expect(senderOf("m1")).toBe("You");
    expect(groupOf("m1").hasAttribute("data-own")).toBe(true);
    expect(senderOf("m2")).toBe("newuser");
    expect(groupOf("m2").hasAttribute("data-own")).toBe(false);
  });

  it("FR-3: a welcome without `you` falls back to its top-level participant_id", () => {
    join({ participant_id: "me" }, [
      text(1, "newuser", "me", false, "10:00"),
      text(2, "newuser", "other", false, "10:01"),
    ]);
    expect(senderOf("m1")).toBe("You");
    expect(senderOf("m2")).toBe("newuser");
  });

  it("FR-8: of two messages from 'newuser', only the signed-in one has the mark", () => {
    render(
      <ChatPane
        messages={[text(1, "newuser", "a", true, "10:00"), text(2, "newuser", "b", false, "10:01")]}
        readOnly={false}
        send={async () => "ok"}
      />,
    );
    expect(groups()).toHaveLength(2);
    expect(document.querySelectorAll("[data-signed-in]")).toHaveLength(1);
    expect(within(groupOf("m1")).getByRole("heading").textContent).toContain("signed in");
    expect(within(groupOf("m2")).getByRole("heading").textContent).not.toContain("signed in");
  });
});
