import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollabProvider, type SocketLike } from "../collab/provider";
import type { SketchAction, SketchAddMessage } from "./sketchTypes";
import { type SketchTransport, useSketch } from "./useSketch";

/** The browser WebSocket boundary (the seam useChat.test.tsx uses): records what is sent. */
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

  sent(type: string): Record<string, unknown>[] {
    return this.sentText.map((t) => JSON.parse(t)).filter((m) => m.type === type);
  }

  serverSends(message: unknown) {
    act(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) })));
  }

  serverCloses(code: number) {
    act(() => this.onclose?.(new CloseEvent("close", { code })));
  }
}

function connect() {
  let socket: FakeSocket | undefined;
  const provider = new CollabProvider({
    inviteId: "inv1",
    name: "Ana",
    createSocket: () => {
      socket = new FakeSocket();
      return socket;
    },
  });
  if (!socket) throw new Error("no socket");
  const s = socket;
  act(() => s.onopen?.(new Event("open")));
  // The session socket's ServerMessage/ClientMessage unions don't list the sketch frames yet.
  return { provider: provider as unknown as SketchTransport, socket: s };
}

function welcome(actions: SketchAction[], full = false) {
  return {
    type: "welcome",
    participant_id: "p1",
    problems: {},
    presence: [],
    run_in_progress: false,
    chat: [],
    sketch: { actions, full },
  };
}

function pen(seq: number, client_id = `c${seq}`): SketchAction {
  return { seq, client_id, kind: "pen", color: "blue", points: [10, 10, 20, 20] };
}

const BOX: SketchAddMessage["action"] = { kind: "box", color: "red", points: [0, 0, 100, 60] };

afterEach(() => {
  cleanup();
});

describe("useSketch", () => {
  it("welcome.sketch fills the board and its full flag", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useSketch({ provider }));

    socket.serverSends(welcome([pen(1), pen(2)], true));

    expect(result.current.visible.map((a) => "seq" in a && a.seq)).toEqual([1, 2]);
    expect(result.current.full).toBe(true);
  });

  it("AC-9: an incoming sketch_added appears in visible", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useSketch({ provider }));
    socket.serverSends(welcome([]));

    const ellipse: SketchAction = {
      seq: 5,
      client_id: "b1",
      kind: "ellipse",
      color: "green",
      points: [100, 100, 300, 200],
    };
    socket.serverSends({ type: "sketch_added", action: ellipse });

    expect(result.current.visible).toEqual([ellipse]);
  });

  it("a sketch_removed drops the action", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useSketch({ provider }));
    socket.serverSends(welcome([pen(1), pen(2)]));

    socket.serverSends({ type: "sketch_removed", seq: 1 });

    expect(result.current.visible).toEqual([pen(2)]);
  });

  it("AC-21: add() shows the action before any echo and sends sketch_add", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useSketch({ provider }));
    socket.serverSends(welcome([pen(1)]));

    act(() => result.current.add(BOX));

    const [frame] = socket.sent("sketch_add");
    expect(frame).toEqual({ type: "sketch_add", client_id: frame?.client_id, action: BOX });
    expect(typeof frame?.client_id).toBe("string");
    expect(result.current.visible).toEqual([pen(1), { client_id: frame?.client_id, ...BOX }]);

    // The echo replaces the pending copy; nothing is shown twice.
    socket.serverSends({
      type: "sketch_added",
      action: { seq: 2, client_id: frame?.client_id, ...BOX },
    });
    expect(result.current.visible).toEqual([
      pen(1),
      { seq: 2, client_id: frame?.client_id, ...BOX },
    ]);
  });

  it("each add() uses a fresh client_id", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useSketch({ provider }));
    socket.serverSends(welcome([]));

    act(() => {
      result.current.add(BOX);
      result.current.add({ kind: "erase", points: [1, 1] });
    });

    const [a, b] = socket.sent("sketch_add");
    expect(a?.client_id).not.toBe(b?.client_id);
    expect(result.current.visible).toHaveLength(2);
  });

  it("AC-13 / AC-15: with no own actions canUndo is false and undo() sends nothing", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useSketch({ provider }));
    socket.serverSends(welcome([pen(1, "someone-else")]));

    expect(result.current.canUndo).toBe(false);
    act(() => result.current.undo());
    expect(socket.sent("sketch_undo")).toEqual([]);
  });

  it("AC-13: undo() sends sketch_undo with the newest own seq, never another's", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useSketch({ provider }));
    socket.serverSends(welcome([]));

    act(() => result.current.add({ kind: "pen", color: "ink", points: [1, 1, 2, 2] }));
    act(() => result.current.add(BOX));
    const [line, box] = socket.sent("sketch_add");
    socket.serverSends({ type: "sketch_added", action: { ...pen(1), client_id: line?.client_id } });
    socket.serverSends({
      type: "sketch_added",
      action: { seq: 2, client_id: box?.client_id, ...BOX },
    });
    socket.serverSends({ type: "sketch_added", action: pen(3, "b-circle") });

    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(socket.sent("sketch_undo")).toEqual([{ type: "sketch_undo", seq: 2 }]);

    socket.serverSends({ type: "sketch_removed", seq: 2 });
    act(() => result.current.undo());
    expect(socket.sent("sketch_undo").at(-1)).toEqual({ type: "sketch_undo", seq: 1 });

    socket.serverSends({ type: "sketch_removed", seq: 1 });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.visible).toEqual([pen(3, "b-circle")]);
  });

  it("clear() sends sketch_clear, empties the board at once, and is undoable", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useSketch({ provider }));
    socket.serverSends(welcome([pen(1, "other")]));

    act(() => result.current.clear());

    const [frame] = socket.sent("sketch_clear");
    expect(frame).toEqual({ type: "sketch_clear", client_id: frame?.client_id });
    expect(typeof frame?.client_id).toBe("string");
    expect(result.current.visible).toEqual([]);

    socket.serverSends({
      type: "sketch_added",
      action: { seq: 2, client_id: frame?.client_id, kind: "clear" },
    });
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(socket.sent("sketch_undo")).toEqual([{ type: "sketch_undo", seq: 2 }]);
  });

  it("a refused add leaves the board; a full refusal sets full", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useSketch({ provider }));
    socket.serverSends(welcome([]));

    act(() => result.current.add(BOX));
    const [frame] = socket.sent("sketch_add");
    socket.serverSends({ type: "sketch_refused", client_id: frame?.client_id, reason: "full" });

    expect(result.current.visible).toEqual([]);
    expect(result.current.full).toBe(true);
  });

  it("the changed-by-someone-else callback fires for others' added/removed, not for own", () => {
    const onOthersChange = vi.fn();
    const { provider, socket } = connect();
    const { result } = renderHook(() => useSketch({ provider, onOthersChange }));
    socket.serverSends(welcome([pen(1, "other")]));
    expect(onOthersChange).not.toHaveBeenCalled();

    act(() => result.current.add(BOX));
    const [frame] = socket.sent("sketch_add");
    const own: SketchAction = { seq: 2, client_id: String(frame?.client_id), ...BOX };
    socket.serverSends({ type: "sketch_added", action: own });
    socket.serverSends({ type: "sketch_removed", seq: 2 });
    expect(onOthersChange).not.toHaveBeenCalled();

    socket.serverSends({ type: "sketch_added", action: pen(3, "other") });
    expect(onOthersChange).toHaveBeenCalledTimes(1);
    expect(onOthersChange).toHaveBeenLastCalledWith({ type: "added", action: pen(3, "other") });

    socket.serverSends({ type: "sketch_removed", seq: 1 });
    expect(onOthersChange).toHaveBeenCalledTimes(2);
    expect(onOthersChange).toHaveBeenLastCalledWith({ type: "removed", seq: 1 });

    // A repeat of something already applied is not a change.
    socket.serverSends({ type: "sketch_added", action: pen(3, "other") });
    socket.serverSends({ type: "sketch_removed", seq: 1 });
    expect(onOthersChange).toHaveBeenCalledTimes(2);
  });

  it("keeps applying messages while nothing renders the board, and a reconnect's welcome adds no duplicates", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useSketch({ provider }));
    socket.serverSends(welcome([pen(1)]));
    socket.serverSends({ type: "sketch_added", action: pen(2) });
    socket.serverSends(welcome([pen(1), pen(2), pen(3)]));

    expect(result.current.visible).toEqual([pen(1), pen(2), pen(3)]);
  });

  it("an own action still unanswered when the connection closes is dropped from pending", () => {
    const { provider, socket } = connect();
    const { result } = renderHook(() => useSketch({ provider }));
    socket.serverSends(welcome([]));

    act(() => result.current.add(BOX));
    expect(result.current.visible).toHaveLength(1);
    socket.serverCloses(1006);

    expect(result.current.visible).toEqual([]);
  });

  it("with no connection nothing is sent and the board stays empty", () => {
    const { result } = renderHook(() => useSketch({ provider: null }));

    act(() => {
      result.current.add(BOX);
      result.current.clear();
      result.current.undo();
    });

    expect(result.current.visible).toEqual([]);
    expect(result.current.canUndo).toBe(false);
  });
});
