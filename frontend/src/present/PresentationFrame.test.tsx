import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnchorHit, FrameEvent, FrameEventType, FrameLink } from "./frameLink";
import { PresentationFrame, type PresentationFrameProps } from "./PresentationFrame";
import type { Anchor, Place, Rect, Stroke } from "./presentTypes";

// The frame side (bridge.js) runs in a real browser only; here the component talks to a fake
// frame link with the same interface as createFrameLink (plan.md "Bridge protocol").
type Handler = (msg: never) => void;

interface FakeLink extends FrameLink {
  emit<T extends FrameEventType>(type: T, msg: FrameEvent<T>): void;
  show: ReturnType<typeof vi.fn> & FrameLink["show"];
  follow: ReturnType<typeof vi.fn> & FrameLink["follow"];
  resolve: ReturnType<typeof vi.fn> & FrameLink["resolve"];
  anchorAt: ReturnType<typeof vi.fn> & FrameLink["anchorAt"];
  destroy: ReturnType<typeof vi.fn> & FrameLink["destroy"];
}

const key = (a: Anchor | null) => JSON.stringify(a);

function fakeLink(rects: Map<string, Rect> = new Map(), hit: AnchorHit | null = null): FakeLink {
  const handlers = new Map<string, Set<Handler>>();
  return {
    show: vi.fn(),
    follow: vi.fn(),
    resolve: vi.fn(async (anchors: (Anchor | null)[]) =>
      anchors.map((a) => rects.get(key(a)) ?? null),
    ),
    anchorAt: vi.fn(async () => hit),
    on(type, handler) {
      const set = handlers.get(type) ?? new Set();
      handlers.set(type, set);
      set.add(handler as Handler);
      return () => set.delete(handler as Handler);
    },
    destroy: vi.fn(),
    emit(type, msg) {
      for (const h of handlers.get(type) ?? []) (h as (m: typeof msg) => void)(msg);
    },
  } as FakeLink;
}

const HEADING: Anchor = { path: [1], fx: 0.5, fy: 0.5 };
const PARA: Anchor = { path: [2, 0], fx: 0, fy: 0 };
const PLACE: Place = { slide: 1, anchor: HEADING };

function setup(props: Partial<PresentationFrameProps> = {}, link = fakeLink()) {
  const createLink = vi.fn((_iframe: HTMLIFrameElement) => link);
  const all: PresentationFrameProps = {
    frameUrl: "/api/present/sessions/inv1/frame#slide=1",
    title: "TCP handshakes",
    isHost: false,
    place: PLACE,
    cursor: null,
    hostName: "Ana",
    strokes: [],
    drawing: false,
    onPlace: vi.fn(),
    onPointer: vi.fn(),
    onStrokeStart: vi.fn(),
    onStrokePoints: vi.fn(),
    createLink,
    ...props,
  };
  const view = render(<PresentationFrame {...all} />);
  const rerender = (next: Partial<PresentationFrameProps>) =>
    view.rerender(<PresentationFrame {...all} {...next} />);
  return { ...view, link, createLink, props: all, rerender };
}

const overlay = () => screen.getByTestId("present-overlay");
const iframe = () => screen.getByTitle("TCP handshakes") as HTMLIFrameElement;

afterEach(() => {
  cleanup();
});

describe("PresentationFrame", () => {
  it("NFR-2: renders the frame URL in an iframe sandboxed with allow-scripts and nothing more", () => {
    const { createLink } = setup();
    expect(iframe().tagName).toBe("IFRAME");
    expect(iframe().getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe().getAttribute("src")).toBe("/api/present/sessions/inv1/frame#slide=1");
    expect(createLink).toHaveBeenCalledWith(iframe());
  });

  it("destroys the frame link on unmount", () => {
    const { link, unmount } = setup();
    unmount();
    expect(link.destroy).toHaveBeenCalled();
  });

  it("AC-18: the overlay ignores the pointer unless drawing is on", () => {
    const { rerender } = setup({ drawing: false });
    expect(overlay().style.pointerEvents).toBe("none");
    rerender({ drawing: true });
    expect(overlay().style.pointerEvents).toBe("auto");
    rerender({ drawing: false });
    expect(overlay().style.pointerEvents).toBe("none");
  });

  it("AC-18: a drag while drawing emits a stroke start and points, and never reaches the iframe", async () => {
    const link = fakeLink(new Map(), { anchor: PARA, rect: { x: 0, y: 0, w: 200, h: 100 } });
    const { props } = setup({ drawing: true }, link);
    const reachedFrame = vi.fn();
    iframe().addEventListener("pointerdown", reachedFrame);
    iframe().addEventListener("pointermove", reachedFrame);

    const notPrevented = fireEvent.pointerDown(overlay(), {
      button: 0,
      pointerId: 1,
      clientX: 20,
      clientY: 10,
    });
    fireEvent.pointerMove(overlay(), { pointerId: 1, clientX: 40, clientY: 20 });
    fireEvent.pointerMove(overlay(), { pointerId: 1, clientX: 60, clientY: 30 });
    fireEvent.pointerUp(overlay(), { pointerId: 1, clientX: 60, clientY: 30 });

    expect(notPrevented).toBe(false); // no text selection or focus change in the page
    expect(link.anchorAt).toHaveBeenCalledWith(20, 10);
    await waitFor(() => expect(props.onStrokeStart).toHaveBeenCalledTimes(1));
    const [start] = vi.mocked(props.onStrokeStart).mock.lastCall ?? [];
    if (!start) throw new Error("no stroke start");
    expect(start.anchor).toEqual(PARA);
    expect(start.points).toEqual([[0.1, 0.1]]);
    expect(typeof start.id).toBe("string");
    await waitFor(() => {
      const sent = vi.mocked(props.onStrokePoints).mock.calls.flatMap(([id, points]) => {
        expect(id).toBe(start.id);
        return points;
      });
      expect(sent).toEqual([
        [0.2, 0.2],
        [0.3, 0.3],
      ]);
    });
    expect(reachedFrame).not.toHaveBeenCalled();
  });

  it("FR-19: moves made after release don't extend the stroke, and nothing is drawn while off", async () => {
    const link = fakeLink(new Map(), { anchor: PARA, rect: { x: 0, y: 0, w: 200, h: 100 } });
    const { props, rerender } = setup({ drawing: true }, link);
    fireEvent.pointerDown(overlay(), { button: 0, pointerId: 1, clientX: 20, clientY: 10 });
    fireEvent.pointerUp(overlay(), { pointerId: 1, clientX: 20, clientY: 10 });
    await waitFor(() => expect(props.onStrokeStart).toHaveBeenCalledTimes(1));
    fireEvent.pointerMove(overlay(), { pointerId: 1, clientX: 80, clientY: 80 });
    rerender({ drawing: false });
    fireEvent.pointerDown(overlay(), { button: 0, pointerId: 2, clientX: 20, clientY: 10 });
    fireEvent.pointerMove(overlay(), { pointerId: 2, clientX: 30, clientY: 10 });
    await new Promise((r) => setTimeout(r, 60));
    expect(props.onStrokeStart).toHaveBeenCalledTimes(1);
    expect(props.onStrokePoints).not.toHaveBeenCalled();
  });

  it("FR-18: a stroke where the frame doesn't answer is drawn relative to the frame's viewport", async () => {
    const link = fakeLink(new Map(), null);
    const { props } = setup({ drawing: true }, link);
    fireEvent.pointerDown(overlay(), { button: 0, pointerId: 1, clientX: 20, clientY: 10 });
    fireEvent.pointerUp(overlay(), { pointerId: 1, clientX: 20, clientY: 10 });
    await waitFor(() => expect(props.onStrokeStart).toHaveBeenCalledTimes(1));
    expect(vi.mocked(props.onStrokeStart).mock.lastCall?.[0].anchor).toBeNull();
  });

  it("AC-12: a cursor anchor renders a label with the host's name at the resolved point; null removes it", async () => {
    const link = fakeLink(new Map([[key(HEADING), { x: 100, y: 50, w: 40, h: 20 }]]));
    const { rerender } = setup({ cursor: HEADING, hostName: "Ana" }, link);
    const label = await screen.findByText("Ana");
    const cursor = label.closest("[data-cursor]") as HTMLElement;
    await waitFor(() => expect(cursor.style.transform).toBe("translate(120px, 60px)"));
    rerender({ cursor: null });
    expect(screen.queryByText("Ana")).toBeNull();
  });

  it("AC-12: the cursor moving within one element stays shown and needs no new resolve", async () => {
    const link = fakeLink(new Map([[key(HEADING), { x: 100, y: 50, w: 40, h: 20 }]]));
    const { rerender } = setup({ cursor: HEADING, hostName: "Ana" }, link);
    const label = await screen.findByText("Ana");
    const cursor = label.closest("[data-cursor]") as HTMLElement;
    await waitFor(() => expect(cursor.style.transform).toBe("translate(120px, 60px)"));
    const calls = link.resolve.mock.calls.length;
    rerender({ cursor: { path: [1], fx: 0.25, fy: 0.5 } });
    // Same element: shown at once at the new point, no round trip to the frame.
    const moved = screen.getByText("Ana").closest("[data-cursor]") as HTMLElement;
    expect(moved.style.transform).toBe("translate(110px, 60px)");
    expect(link.resolve.mock.calls.length).toBe(calls);
  });

  it("AC-20b: a stroke anchored to <body> (empty path) is resolved and drawn", async () => {
    const BODY: Anchor = { path: [], fx: 0.1, fy: 0.1 };
    const link = fakeLink(new Map([[key(BODY), { x: 0, y: 0, w: 100, h: 100 }]]));
    const stroke: Stroke = {
      id: "b1",
      participant_id: "p1",
      color: "#e5484d",
      anchor: BODY,
      points: [
        [0.1, 0.1],
        [0.2, 0.2],
      ],
    };
    const { container, rerender } = setup({ strokes: [] }, link);
    rerender({ strokes: [stroke] });
    await waitFor(() => expect(container.querySelectorAll("polyline")).toHaveLength(1));
  });

  it("AC-19: two strokes render in their own colours on the content they were drawn on", async () => {
    const strokes: Stroke[] = [
      {
        id: "s1",
        participant_id: "p1",
        color: "#e5484d",
        anchor: HEADING,
        points: [
          [0, 0],
          [1, 1],
        ],
      },
      { id: "s2", participant_id: "p2", color: "#0090ff", anchor: PARA, points: [[0.5, 0.5]] },
    ];
    const link = fakeLink(
      new Map([
        [key(HEADING), { x: 100, y: 50, w: 40, h: 20 }],
        [key(PARA), { x: 0, y: 200, w: 300, h: 100 }],
      ]),
    );
    const { container } = setup({ strokes }, link);
    await waitFor(() => {
      const lines = [...container.querySelectorAll("polyline")];
      expect(lines.map((l) => l.getAttribute("stroke"))).toEqual(["#e5484d", "#0090ff"]);
      expect(lines.map((l) => l.getAttribute("points"))).toEqual(["100,50 140,70", "150,250"]);
    });
  });

  it("FR-21: strokes and cursor are re-resolved when the frame reports layout or scrolling", async () => {
    const rects = new Map([[key(HEADING), { x: 100, y: 50, w: 40, h: 20 }]]);
    const link = fakeLink(rects);
    const strokes: Stroke[] = [
      { id: "s1", participant_id: "p1", color: "#e5484d", anchor: HEADING, points: [[0, 0]] },
    ];
    const { container } = setup({ strokes }, link);
    await waitFor(() =>
      expect(container.querySelector("polyline")?.getAttribute("points")).toBe("100,50"),
    );
    rects.set(key(HEADING), { x: 100, y: -150, w: 40, h: 20 });
    act(() => link.emit("layout", { sdd: "layout" }));
    await waitFor(() =>
      expect(container.querySelector("polyline")?.getAttribute("points")).toBe("100,-150"),
    );
    rects.set(key(HEADING), { x: 100, y: 10, w: 40, h: 20 });
    act(() => link.emit("scrolled", { sdd: "scrolled", anchor: PARA }));
    await waitFor(() =>
      expect(container.querySelector("polyline")?.getAttribute("points")).toBe("100,10"),
    );
  });

  it("FR-18: keeps the last known geometry when the frame stops answering", async () => {
    const rects = new Map([[key(HEADING), { x: 100, y: 50, w: 40, h: 20 }]]);
    const link = fakeLink(rects);
    const strokes: Stroke[] = [
      { id: "s1", participant_id: "p1", color: "#e5484d", anchor: HEADING, points: [[0, 0]] },
    ];
    const { container } = setup({ strokes }, link);
    await waitFor(() =>
      expect(container.querySelector("polyline")?.getAttribute("points")).toBe("100,50"),
    );
    link.resolve.mockImplementation(async () => null);
    act(() => link.emit("layout", { sdd: "layout" }));
    await act(async () => {});
    expect(container.querySelector("polyline")?.getAttribute("points")).toBe("100,50");
  });

  it("AC-13: a follower's component sends follow {on: true} and shows every place", () => {
    const { link, rerender } = setup({ isHost: false });
    expect(link.follow).toHaveBeenLastCalledWith(true);
    act(() => link.emit("ready", { sdd: "ready", kind: "slides", slideCount: 4 }));
    expect(link.follow).toHaveBeenLastCalledWith(true);
    expect(link.show).toHaveBeenLastCalledWith(PLACE);
    const next: Place = { slide: 1, anchor: PARA };
    rerender({ place: next });
    expect(link.show).toHaveBeenLastCalledWith(next);
  });

  it("AC-13: a follower doesn't report its own scrolling or pointer", () => {
    const { link, props } = setup({ isHost: false });
    act(() => link.emit("scrolled", { sdd: "scrolled", anchor: PARA }));
    act(() => link.emit("pointer", { sdd: "pointer", x: 1, y: 2, anchor: PARA }));
    expect(props.onPlace).not.toHaveBeenCalled();
    expect(props.onPointer).not.toHaveBeenCalled();
  });

  it("FR-10/FR-13: the host leads: follow off, scrolling reports the place, pointer reports the cursor", () => {
    const { link, props, rerender } = setup({ isHost: true });
    expect(link.follow).toHaveBeenLastCalledWith(false);
    act(() => link.emit("scrolled", { sdd: "scrolled", anchor: PARA }));
    expect(props.onPlace).toHaveBeenCalledWith({ slide: 1, anchor: PARA });
    act(() => link.emit("pointer", { sdd: "pointer", x: 1, y: 2, anchor: HEADING }));
    expect(props.onPointer).toHaveBeenLastCalledWith(HEADING);
    act(() => link.emit("pointer", { sdd: "pointer", anchor: null }));
    expect(props.onPointer).toHaveBeenLastCalledWith(null);

    // A new slide is shown in the host's own frame; the echo of its own scroll is not.
    link.show.mockClear();
    rerender({ isHost: true, place: { slide: 1, anchor: PARA } });
    expect(link.show).not.toHaveBeenCalled();
    rerender({ isHost: true, place: { slide: 2, anchor: null } });
    expect(link.show).toHaveBeenLastCalledWith({ slide: 2, anchor: null });

    // Losing hosting turns following on.
    rerender({ isHost: false, place: { slide: 2, anchor: null } });
    expect(link.follow).toHaveBeenLastCalledWith(true);
  });

  it("forwards keys pressed inside the frame", () => {
    const onKey = vi.fn();
    const { link } = setup({ onKey });
    act(() => link.emit("key", { sdd: "key", key: "ArrowRight" }));
    expect(onKey).toHaveBeenCalledWith("ArrowRight");
  });
});
