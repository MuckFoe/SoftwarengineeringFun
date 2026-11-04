import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GifResult } from "../../api/types";
import { CollabProvider, type SocketLike } from "../../collab/provider";
import { GifPicker } from "./GifPicker";
import { markNoticeSeen, noticeSeen } from "./gifNotice";
import { SEARCH_DEBOUNCE_MS } from "./useGifSearch";

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

  searches(): { type: string; request_id: string; q: string }[] {
    return this.sentText.map((t) => JSON.parse(t)).filter((m) => m.type === "gif_search");
  }

  lastSearch() {
    const all = this.searches();
    const last = all[all.length - 1];
    if (!last) throw new Error("no gif_search sent");
    return last;
  }

  serverSends(message: unknown) {
    act(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) })));
  }
}

const INVITE = "inv1";

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

function gif(id: string, title = id): GifResult {
  return {
    id,
    title,
    url: `https://media.example/${id}.gif`,
    still_url: `https://media.example/${id}_s.gif`,
    width: 200,
    height: 150,
  };
}

function setup() {
  const { provider, socket } = connect();
  const onPick = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <GifPicker invite={INVITE} provider={provider} onPick={onPick} onClose={onClose} />,
  );
  return { provider, socket, onPick, onClose, view };
}

function reply(socket: FakeSocket, results: GifResult[], trending = false) {
  socket.serverSends({
    type: "gif_results",
    request_id: socket.lastSearch().request_id,
    trending,
    results,
  });
}

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe("GifPicker", () => {
  it("FR-5: first open shows only the notice and sends nothing until Continue", () => {
    const { socket, view, provider } = setup();

    expect(screen.getByText(/third-party/i)).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(socket.searches()).toEqual([]);
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(document.activeElement).toBe(cont);

    fireEvent.click(cont);

    expect(socket.searches().map((m) => m.q)).toEqual([""]);
    expect(noticeSeen(INVITE)).toBe(true);
    expect(screen.queryByText(/third-party/i)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));

    view.unmount();
    render(<GifPicker invite={INVITE} provider={provider} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText(/third-party/i)).toBeNull();
    expect(screen.getByRole("searchbox")).toBeTruthy();
  });

  it("FR-2: notice already seen, mounting sends q '' and focuses the field", () => {
    markNoticeSeen(INVITE);
    const { socket } = setup();

    expect(socket.searches().map((m) => m.q)).toEqual([""]);
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
    expect(screen.getByRole("status").textContent).toBe("Loading");
  });

  it("FR-1 / FR-11: typing 'cat' sends one gif_search after the debounce and renders results with attribution", () => {
    markNoticeSeen(INVITE);
    const { socket } = setup();
    reply(socket, [gif("t1", "Trending")], true);

    type(screen.getByRole("searchbox"), "c");
    type(screen.getByRole("searchbox"), "ca");
    type(screen.getByRole("searchbox"), "cat");
    expect(socket.searches()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(socket.searches().map((m) => m.q)).toEqual(["", "cat"]);

    reply(socket, [gif("c1", "Cat one"), gif("c2", "Cat two")]);

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(screen.getByAltText("Cat one")).toBeTruthy();
    expect(screen.getByAltText("Cat two")).toBeTruthy();
    expect(screen.getByText("Powered by GIPHY")).toBeTruthy();
  });

  it("FR-9: shows 'GIF search unavailable'", () => {
    markNoticeSeen(INVITE);
    const { socket } = setup();
    socket.serverSends({
      type: "error",
      code: "gif_unavailable",
      request_id: socket.lastSearch().request_id,
    });

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("GIF search unavailable");
  });

  it("NFR-3: shows 'wait 12 s' on gif_rate_limited", () => {
    markNoticeSeen(INVITE);
    const { socket } = setup();
    socket.serverSends({
      type: "error",
      code: "gif_rate_limited",
      request_id: socket.lastSearch().request_id,
      retry_after: 12,
    });

    expect(screen.getByRole("status").textContent).toBe("Too many searches — wait 12 s");
  });

  it("NFR-6: keyboard only — type, ArrowDown, ArrowRight, Enter picks the second result; Escape closes", () => {
    markNoticeSeen(INVITE);
    const { socket, onPick, onClose } = setup();
    const field = screen.getByRole("searchbox");
    expect(document.activeElement).toBe(field);

    type(field, "cat");
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    reply(socket, [gif("c1", "Cat one"), gif("c2", "Cat two"), gif("c3", "Cat three")]);

    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    const grid = screen.getByRole("listbox");
    expect(document.activeElement).toBe(grid);
    const options = screen.getAllByRole("option");
    expect(grid.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    expect(grid.getAttribute("aria-activedescendant")).toBe(options[1]?.id);

    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("c2");

    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("NFR-6: arrows move by row in the grid, and ArrowUp from the first row returns to the field", () => {
    markNoticeSeen(INVITE);
    const { socket } = setup();
    reply(
      socket,
      Array.from({ length: 6 }, (_, i) => gif(`g${i}`)),
      true,
    );

    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    const grid = screen.getByRole("listbox");
    const options = screen.getAllByRole("option");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(grid.getAttribute("aria-activedescendant")).toBe(options[3]?.id);
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(grid.getAttribute("aria-activedescendant")).toBe(options[4]?.id);
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(grid.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(grid.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });

  it("Escape from the field closes the picker", () => {
    markNoticeSeen(INVITE);
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
