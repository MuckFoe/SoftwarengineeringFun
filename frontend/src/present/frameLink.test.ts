import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameLink, type FrameLink, REQUEST_TIMEOUT_MS } from "./frameLink";
import type { Anchor, FrameToPageMessage, PageToFrameMessage } from "./presentTypes";

// The unit is the parent side of the bridge protocol: real iframes give real windows as
// `event.source`; only the frame's answers are played by the test.
let iframe: HTMLIFrameElement;
let other: HTMLIFrameElement;
let link: FrameLink;
let posted: PageToFrameMessage[];

function frameWindow(el: HTMLIFrameElement): Window {
  const win = el.contentWindow;
  if (!win) throw new Error("iframe has no window");
  return win;
}

function fromFrame(
  data: FrameToPageMessage | Record<string, unknown>,
  source: Window = frameWindow(iframe),
) {
  window.dispatchEvent(new MessageEvent("message", { data, source }));
}

beforeEach(() => {
  iframe = document.createElement("iframe");
  other = document.createElement("iframe");
  document.body.append(iframe, other);
  posted = [];
  vi.spyOn(frameWindow(iframe), "postMessage").mockImplementation((msg: unknown) => {
    posted.push(msg as PageToFrameMessage);
  });
  link = createFrameLink(iframe);
});

afterEach(() => {
  link.destroy();
  iframe.remove();
  other.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The req id of the n-th message posted to the frame. */
function reqOf(n: number): number {
  const msg = posted[n];
  if (!msg || !("req" in msg)) throw new Error(`message ${n} carries no req`);
  return msg.req;
}

const anchor: Anchor = { path: [0, 2], fx: 0.5, fy: 0.25 };

describe("createFrameLink", () => {
  it("sends show and follow to the frame", () => {
    link.show({ slide: 2, anchor });
    link.follow(true);
    expect(posted).toEqual([
      { sdd: "show", slide: 2, anchor },
      { sdd: "follow", on: true },
    ]);
  });

  it("delivers frame messages to handlers of that type", () => {
    const onPointer = vi.fn();
    const onReady = vi.fn();
    link.on("pointer", onPointer);
    link.on("ready", onReady);
    fromFrame({ sdd: "pointer", x: 3, y: 4, anchor });
    fromFrame({ sdd: "pointer", anchor: null });
    expect(onPointer).toHaveBeenCalledTimes(2);
    expect(onPointer).toHaveBeenLastCalledWith({ sdd: "pointer", anchor: null });
    expect(onReady).not.toHaveBeenCalled();
  });

  it("returns an unsubscribe from on", () => {
    const onLayout = vi.fn();
    const off = link.on("layout", onLayout);
    off();
    fromFrame({ sdd: "layout" });
    expect(onLayout).not.toHaveBeenCalled();
  });

  it("NFR-2: ignores a message from another window", () => {
    const onScrolled = vi.fn();
    link.on("scrolled", onScrolled);
    fromFrame({ sdd: "scrolled", anchor }, frameWindow(other));
    fromFrame({ sdd: "scrolled", anchor }, window);
    expect(onScrolled).not.toHaveBeenCalled();
  });

  it("ignores messages without an sdd type", () => {
    const onKey = vi.fn();
    link.on("key", onKey);
    fromFrame({ type: "key", key: "ArrowRight" });
    expect(onKey).not.toHaveBeenCalled();
  });

  it("maps resolved rects back to the request by req id", async () => {
    const first = link.resolve([anchor, null]);
    const second = link.resolve([anchor]);
    const reqA = reqOf(0);
    const reqB = reqOf(1);
    expect(posted[0]).toEqual({ sdd: "resolve", req: reqA, anchors: [anchor, null] });
    expect(reqA).not.toBe(reqB);
    fromFrame({ sdd: "resolved", req: reqB, rects: [{ x: 9, y: 9, w: 1, h: 1 }] });
    fromFrame({ sdd: "resolved", req: reqA, rects: [{ x: 1, y: 2, w: 3, h: 4 }, null] });
    await expect(first).resolves.toEqual([{ x: 1, y: 2, w: 3, h: 4 }, null]);
    await expect(second).resolves.toEqual([{ x: 9, y: 9, w: 1, h: 1 }]);
  });

  it("answers anchorAt with the frame's anchor and rect", async () => {
    const pending = link.anchorAt(10, 20);
    expect(posted[0]).toMatchObject({ sdd: "anchorAt", x: 10, y: 20 });
    const req = reqOf(0);
    fromFrame({ sdd: "anchorAt", req, anchor, rect: { x: 0, y: 0, w: 5, h: 5 } });
    await expect(pending).resolves.toEqual({ anchor, rect: { x: 0, y: 0, w: 5, h: 5 } });
  });

  it("FR-18: an unanswered anchorAt resolves null after 150 ms", async () => {
    vi.useFakeTimers();
    let result: unknown = "pending";
    void link.anchorAt(1, 1).then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(result).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(REQUEST_TIMEOUT_MS).toBe(150);
    expect(result).toBeNull();
  });

  it("an unanswered resolve resolves null; a late answer is ignored", async () => {
    vi.useFakeTimers();
    const pending = link.resolve([anchor]);
    const req = reqOf(0);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
    expect(() => fromFrame({ sdd: "resolved", req, rects: [null] })).not.toThrow();
  });

  it("a resolved answer from another window does not settle the request", async () => {
    vi.useFakeTimers();
    const pending = link.resolve([anchor]);
    const req = reqOf(0);
    fromFrame({ sdd: "resolved", req, rects: [{ x: 6, y: 6, w: 6, h: 6 }] }, frameWindow(other));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
  });

  it("destroy removes the listener and settles pending requests with null", async () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const onLayout = vi.fn();
    link.on("layout", onLayout);
    const pending = link.anchorAt(1, 1);
    link.destroy();
    expect(removeSpy).toHaveBeenCalledWith("message", expect.any(Function));
    fromFrame({ sdd: "layout" });
    expect(onLayout).not.toHaveBeenCalled();
    await expect(pending).resolves.toBeNull();
  });
});
