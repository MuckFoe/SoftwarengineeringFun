// The presentation frame and everything drawn over it (plan.md "Content-relative place",
// "Following", "Drawing"). The iframe holds only the presentation; the host's cursor and the
// strokes live in an overlay in this page, positioned from anchors the frame resolves, so a
// frame that stops answering (FR-18) never stops the overlay from working.
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createFrameLink, type FrameLink } from "./frameLink";
import styles from "./PresentationFrame.module.css";
import { type Anchor, type Place, type Rect, type Stroke, strokeColor } from "./presentTypes";

/** Points of a drawing are sent in batches this often (plan.md "Drawing"). */
export const STROKE_BATCH_MS = 30;

export interface StrokeStart {
  id: string;
  anchor: Anchor | null;
  points: [number, number][];
}

export interface PresentationFrameProps {
  frameUrl: string;
  /** Accessible name of the iframe: the presentation's title. */
  title: string;
  isHost: boolean;
  place: Place;
  /** The host's pointer, or null when it is off the presentation. */
  cursor: Anchor | null;
  /** The label on the simulated cursor. */
  hostName: string | null;
  strokes: Stroke[];
  /** This participant's drawing tool (FR-19). */
  drawing: boolean;
  /** Host only: the frame scrolled, so the place's anchor moved. */
  onPlace(place: Place): void;
  /** Host only: the pointer moved over the frame, or left it (null). */
  onPointer(anchor: Anchor | null): void;
  onStrokeStart(stroke: StrokeStart): void;
  onStrokePoints(id: string, points: [number, number][]): void;
  /** A navigation key pressed inside the frame (the page decides whether it applies). */
  onKey?(key: string): void;
  /** Seam for tests; defaults to the real postMessage bridge. */
  createLink?(iframe: HTMLIFrameElement): FrameLink;
}

const VIEWPORT = "null";
// The frame resolves an anchor to its element's box, so the element path alone is the key:
// a pointer moving within one element needs no new round trip and the cursor never unmounts.
const keyOf = (anchor: Anchor | null) =>
  anchor === null ? VIEWPORT : `p:${anchor.path.join("/")}`;
const round = (n: number) => Math.round(n * 10) / 10;

function at(rect: Rect, [fx, fy]: [number, number]): [number, number] {
  return [round(rect.x + fx * rect.w), round(rect.y + fy * rect.h)];
}

function strokeId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

interface Drag {
  pointerId: number;
  id: string;
  left: number;
  top: number;
  /** The box points are fractions of; null until the frame said what's under pointer-down. */
  box: Rect | null;
  /** Raw overlay points collected before `box` is known. */
  early: [number, number][];
  batch: [number, number][];
  timer: ReturnType<typeof setTimeout> | null;
  ended: boolean;
}

type Send = (id: string, points: [number, number][]) => void;

function flush(drag: Drag, send: Send) {
  if (drag.timer) clearTimeout(drag.timer);
  drag.timer = null;
  if (drag.batch.length === 0) return;
  const points = drag.batch;
  drag.batch = [];
  send(drag.id, points);
}

function addPoint(drag: Drag, x: number, y: number, send: Send) {
  if (!drag.box) {
    drag.early.push([x, y]);
    return;
  }
  drag.batch.push([(x - drag.box.x) / drag.box.w, (y - drag.box.y) / drag.box.h]);
  if (!drag.timer) drag.timer = setTimeout(() => flush(drag, send), STROKE_BATCH_MS);
}

export function PresentationFrame(props: PresentationFrameProps) {
  const { frameUrl, title, isHost, place, cursor, hostName, strokes, drawing } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<FrameLink | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const dragRef = useRef<Drag | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const [rects, setRects] = useState<ReadonlyMap<string, Rect>>(new Map());

  function viewport(): Rect {
    const el = overlayRef.current;
    return { x: 0, y: 0, w: el?.clientWidth || 1, h: el?.clientHeight || 1 };
  }

  // One link per iframe; frame events read the latest props through `latest`.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const link = (latest.current.createLink ?? createFrameLink)(iframe);
    linkRef.current = link;
    const relayout = () => setLayoutTick((n) => n + 1);
    const offs = [
      link.on("ready", () => {
        link.follow(!latest.current.isHost);
        link.show(latest.current.place);
        relayout();
      }),
      link.on("layout", relayout),
      link.on("scrolled", (msg) => {
        relayout();
        const p = latest.current;
        if (p.isHost) p.onPlace({ slide: p.place.slide, anchor: msg.anchor });
      }),
      link.on("pointer", (msg) => {
        if (latest.current.isHost) latest.current.onPointer(msg.anchor);
      }),
      link.on("key", (msg) => latest.current.onKey?.(msg.key)),
    ];
    return () => {
      for (const off of offs) off();
      link.destroy();
      linkRef.current = null;
      const drag = dragRef.current;
      if (drag?.timer) clearTimeout(drag.timer);
      dragRef.current = null;
    };
  }, []);

  // Followers can't scroll or navigate the frame themselves (FR-14).
  useEffect(() => {
    linkRef.current?.follow(!isHost);
  }, [isHost]);

  // Followers are shown every place; the host only a new slide, never the echo of its own scroll.
  const shownSlide = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const link = linkRef.current;
    if (!link) return;
    if (!isHost || shownSlide.current !== place.slide) link.show(place);
    shownSlide.current = place.slide;
  }, [isHost, place]);

  // Re-resolve every anchor on the overlay whenever the set changes or the frame's layout does.
  const anchors = useMemo(() => {
    const byKey = new Map<string, Anchor | null>();
    if (cursor) byKey.set(keyOf(cursor), cursor);
    for (const s of strokes) byKey.set(keyOf(s.anchor), s.anchor);
    return byKey;
  }, [cursor, strokes]);
  const anchorKeys = [...anchors.keys()].sort().join("\n");
  const resolveSeq = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: anchorKeys stands for anchors; layoutTick forces a refresh
  useEffect(() => {
    const link = linkRef.current;
    const wanted = [...anchors.entries()].filter(([k]) => k !== VIEWPORT);
    const seq = ++resolveSeq.current;
    const vp = viewport();
    setRects((prev) => (anchors.has(VIEWPORT) ? new Map(prev).set(VIEWPORT, vp) : prev));
    if (!link || wanted.length === 0) return;
    void link.resolve(wanted.map(([, a]) => a)).then((found) => {
      // An unanswered request keeps the last known geometry (FR-18).
      if (!found || seq !== resolveSeq.current) return;
      setRects((prev) => {
        const next = new Map(prev);
        wanted.forEach(([k], i) => {
          const rect = found[i];
          if (rect) next.set(k, rect);
        });
        return next;
      });
    });
  }, [anchorKeys, layoutTick]);

  // --- Drawing input --------------------------------------------------------------------

  const send = (id: string, points: [number, number][]) =>
    latest.current.onStrokePoints(id, points);

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    drag.ended = true;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (drag.box) flush(drag, send);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drawing || e.button !== 0 || dragRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const bounds = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - bounds.left;
    const y = e.clientY - bounds.top;
    const drag: Drag = {
      pointerId: e.pointerId,
      id: strokeId(),
      left: bounds.left,
      top: bounds.top,
      box: null,
      early: [],
      batch: [],
      timer: null,
      ended: false,
    };
    dragRef.current = drag;
    const link = linkRef.current;
    const hit = link ? link.anchorAt(x, y) : Promise.resolve(null);
    void hit.then((found) => {
      // Where the frame doesn't answer, the stroke is relative to the frame's viewport.
      const anchor = found?.rect ? found.anchor : null;
      drag.box = found?.rect && anchor ? found.rect : viewport();
      const first: [number, number] = [
        (x - drag.box.x) / drag.box.w,
        (y - drag.box.y) / drag.box.h,
      ];
      latest.current.onStrokeStart({ id: drag.id, anchor, points: [first] });
      for (const [px, py] of drag.early) addPoint(drag, px, py, send);
      drag.early = [];
      if (drag.ended) flush(drag, send);
    });
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    addPoint(drag, e.clientX - drag.left, e.clientY - drag.top, send);
  }

  // Turning the tool off mid-drag ends the stroke.
  useEffect(() => {
    if (drawing) return;
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    drag.ended = true;
    if (drag.box) flush(drag, (id, points) => latest.current.onStrokePoints(id, points));
  }, [drawing]);

  // --- Rendering ------------------------------------------------------------------------

  const cursorRect = cursor ? rects.get(keyOf(cursor)) : undefined;
  const cursorAt = cursor && cursorRect ? at(cursorRect, [cursor.fx, cursor.fy]) : null;

  return (
    // The frame is one keyboard stop that shows its own focus ring (a focused iframe cannot:
    // `:focus` does not match it while its document holds focus); Enter moves focus inside.
    // biome-ignore lint/a11y/useSemanticElements: a focus stop around a sandboxed iframe
    <div
      className={styles.frame}
      role="button"
      aria-label={`${title}, press Enter to interact`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: see above
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) iframeRef.current?.focus();
      }}
    >
      <iframe
        ref={iframeRef}
        tabIndex={-1}
        className={styles.iframe}
        src={frameUrl}
        title={title}
        sandbox="allow-scripts"
      />
      <div
        ref={overlayRef}
        className={styles.overlay}
        data-testid="present-overlay"
        data-drawing={drawing || undefined}
        style={{ pointerEvents: drawing ? "auto" : "none" }}
        aria-hidden="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <svg className={styles.strokes} role="presentation">
          {strokes.map((s) => {
            const rect = rects.get(keyOf(s.anchor));
            if (!rect) return null;
            return (
              <polyline
                key={s.id}
                points={s.points.map((p) => at(rect, p).join(",")).join(" ")}
                stroke={strokeColor(s.color)}
              />
            );
          })}
        </svg>
        {cursorAt && (
          <div
            className={styles.cursor}
            data-cursor
            style={{ transform: `translate(${cursorAt[0]}px, ${cursorAt[1]}px)` }}
          >
            <svg className={styles.arrow} viewBox="0 0 12 18" role="presentation">
              <path d="M0 0 L0 15 L4 11 L7 18 L9.5 17 L6.5 10 L12 10 Z" />
            </svg>
            <span className={styles.label}>{hostName ?? ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}
