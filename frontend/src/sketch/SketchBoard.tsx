import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import type { IconName } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { InlineMessage } from "../ui/InlineMessage";
import { Toolbar } from "../ui/Toolbar";
import {
  type BoardPoint,
  clickShape,
  isClick,
  normaliseRect,
  simplifyPath,
  toBoard,
} from "./geometry";
import { drawBoard, type SketchColours } from "./render";
import styles from "./SketchBoard.module.css";
import {
  type ActionBody,
  BOARD_H,
  BOARD_W,
  PALETTE,
  type PendingAction,
  type SketchAction,
  type SketchColor,
} from "./sketchTypes";

// Spec 022 task 10: the board canvas (plan Rendering, Board shape; Toolbar and keyboard —
// Pointer). A fixed 1600×1000 board scaled to its container's width (FR-3); pen and eraser
// draw live while dragging, box and ellipse preview while dragging, a click places a
// standard-size shape (FR-4–FR-6); the finished action goes to `add` on pointer-up.
// Task 13 (plan Toolbar and keyboard): `SketchBoard` wraps the canvas with the toolbar,
// Undo, Clear and its confirmation, the full message and the live region.

export type SketchTool = "pen" | "box" | "ellipse" | "erase";
export type DrawnAction = Exclude<ActionBody, { kind: "clear" }>;

export interface SketchCanvasProps {
  /** What the board shows, in drawing order (`visible()` of the sketch state). */
  visible: ReadonlyArray<SketchAction | PendingAction>;
  /** Called once per finished stroke or shape, on pointer-up. */
  add: (action: DrawnAction) => void;
  tool: SketchTool;
  color: SketchColor;
  /** No drawing at all: the stale page, or a board shown for reading only. */
  readOnly?: boolean;
}

type Draft = {
  pointerId: number;
  tool: SketchTool;
  color: SketchColor;
  start: BoardPoint;
  /** Pen/eraser: the raw path so far. Box/ellipse: start then the current corner. */
  points: number[];
};

function draftBody(d: Draft, done: boolean): DrawnAction {
  if (d.tool === "pen") {
    return { kind: "pen", color: d.color, points: done ? simplifyPath(d.points) : d.points };
  }
  if (d.tool === "erase")
    return { kind: "erase", points: done ? simplifyPath(d.points) : d.points };
  const end = { x: d.points.at(-2) ?? d.start.x, y: d.points.at(-1) ?? d.start.y };
  const rect = done && isClick(d.start, end) ? clickShape(d.start) : normaliseRect(d.start, end);
  return { kind: d.tool, color: d.color, points: rect };
}

function readColours(el: Element): SketchColours {
  const css = getComputedStyle(el);
  return Object.fromEntries(
    PALETTE.map((c) => [c, css.getPropertyValue(`--sketch-${c}`).trim() || "currentColor"]),
  ) as SketchColours;
}

/** A short, stable hash of the confirmed seqs on show (test-only `data-sketch-hash`). */
function seqHash(actions: ReadonlyArray<SketchAction | PendingAction>): string {
  let h = 5381;
  for (const a of actions) {
    if (!("seq" in a)) continue;
    for (const ch of `${a.seq},`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  }
  return h.toString(16);
}

/** The board canvas alone: draws `visible` and turns pointer strokes into `add` calls. */
export function SketchCanvas({ visible, add, tool, color, readOnly = false }: SketchCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draftRef = useRef<Draft | null>(null);
  const [width, setWidth] = useState(0);
  const [colours, setColours] = useState<SketchColours | null>(null);
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  const backingW = Math.round(width * dpr);
  const backingH = Math.round((width * dpr * BOARD_H) / BOARD_W);

  // Fit the container's width, keeping 16:10 (FR-3).
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    setWidth(wrap.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(w);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Palette colours from the tokens, re-read when the appearance changes (FR-7).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reread = () => setColours(readColours(canvas));
    reread();
    const mo = new MutationObserver(reread);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-appearance", "class", "style"],
    });
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    media?.addEventListener("change", reread);
    return () => {
      mo.disconnect();
      media?.removeEventListener("change", reread);
    };
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !colours || canvas.width === 0) return;
    const d = draftRef.current;
    const actions: ActionBody[] = d ? [...visible, draftBody(d, false)] : [...visible];
    drawBoard(ctx, actions, colours, canvas.width / BOARD_W);
  }, [visible, colours]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a backing-store resize clears the canvas, so redraw after it
  useEffect(redraw, [redraw, backingW, backingH]);

  const hash = useMemo(() => seqHash(visible), [visible]);

  function point(e: ReactPointerEvent<HTMLCanvasElement>): BoardPoint {
    return toBoard(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 || draftRef.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = point(e);
    draftRef.current = { pointerId: e.pointerId, tool, color, start: p, points: [p.x, p.y] };
    redraw();
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const d = draftRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = point(e);
    if (d.tool === "pen" || d.tool === "erase") {
      if (d.points.at(-2) !== p.x || d.points.at(-1) !== p.y) d.points.push(p.x, p.y);
    } else {
      d.points = [d.start.x, d.start.y, p.x, p.y];
    }
    redraw();
  }

  function onPointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    const d = draftRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    onPointerMove(e);
    draftRef.current = null;
    add(draftBody(d, true));
  }

  function onPointerCancel(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (draftRef.current?.pointerId !== e.pointerId) return;
    draftRef.current = null;
    redraw();
  }

  const handlers = readOnly ? {} : { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <canvas
        ref={canvasRef}
        className={readOnly ? styles.canvas : `${styles.canvas} ${styles.drawable}`}
        role="img"
        aria-label={readOnly ? "Sketch board (read-only)" : "Sketch board"}
        tabIndex={0}
        data-sketch-hash={hash}
        width={backingW}
        height={backingH}
        style={
          width > 0
            ? { width: `${width}px`, height: `${(width * BOARD_H) / BOARD_W}px` }
            : undefined
        }
        {...handlers}
      />
    </div>
  );
}

export interface SketchBoardProps {
  /** The `useSketch` result: what to show, whether the board is full, and the actions. */
  visible: ReadonlyArray<SketchAction | PendingAction>;
  full?: boolean;
  canUndo?: boolean;
  add?: (action: DrawnAction) => void;
  clear?: () => void;
  undo?: () => void;
  /** No drawing, toolbar, Undo or Clear: the stale page (FR-16). */
  readOnly?: boolean;
  /**
   * Counts board changes made by other participants (bump it from `useSketch`'s
   * `onOthersChange`); each increase may be announced, at most once per 5 s (NFR-7).
   */
  othersChanged?: number;
}

const TOOLS: ReadonlyArray<{ tool: SketchTool; name: string; icon: IconName }> = [
  { tool: "pen", name: "Pen", icon: "pen" },
  { tool: "box", name: "Box", icon: "square" },
  { tool: "ellipse", name: "Circle", icon: "circle" },
  { tool: "erase", name: "Eraser", icon: "eraser" },
];

const ANNOUNCE_EVERY_MS = 5000;
const ANNOUNCEMENT = "Someone changed the sketch.";
const FULL_MESSAGE = "The sketch is full. Clear the board or undo something to make room.";
const NOTHING_TO_UNDO = "Nothing of yours to undo in this visit.";

const colourName = (c: SketchColor) => c.charAt(0).toUpperCase() + c.slice(1);
const withState = (name: string, selected: boolean) => (selected ? `${name}, selected` : name);
const noop = () => {};

/**
 * A polite announcement of others' changes, throttled to one per `ANNOUNCE_EVERY_MS`: the first
 * change is said at once, changes inside the window are said once when it ends. Repeats
 * alternate a trailing no-break space so screen readers hear the same words again.
 */
function useOthersAnnouncement(othersChanged: number): string {
  const [said, setSaid] = useState({ count: 0 });
  const seen = useRef(othersChanged);
  const lastAt = useRef(Number.NEGATIVE_INFINITY);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (othersChanged === seen.current) return;
    seen.current = othersChanged;
    const say = () => {
      timer.current = null;
      lastAt.current = Date.now();
      setSaid((s) => ({ count: s.count + 1 }));
    };
    const wait = lastAt.current + ANNOUNCE_EVERY_MS - Date.now();
    if (wait <= 0) say();
    else if (!timer.current) timer.current = setTimeout(say, wait);
  }, [othersChanged]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (said.count === 0) return "";
  return said.count % 2 === 1 ? ANNOUNCEMENT : `${ANNOUNCEMENT}\u00a0`;
}

/** The sketch board: toolbar, Undo, Clear, the canvas, the full message and the live region. */
export function SketchBoard({
  visible,
  full = false,
  canUndo = false,
  add = noop,
  clear = noop,
  undo = noop,
  readOnly = false,
  othersChanged = 0,
}: SketchBoardProps) {
  // Per participant, never sent (FR-8).
  const [tool, setTool] = useState<SketchTool>("pen");
  const [color, setColor] = useState<SketchColor>("ink");
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const undoReasonId = useId();
  const fullId = useId();
  const announcement = useOthersAnnouncement(othersChanged);

  // Cancel is the default (FR-12). Runs after the dialog's own open effect.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (readOnly || e.altKey || e.shiftKey || !(e.ctrlKey || e.metaKey)) return;
    if (e.key.toLowerCase() !== "z") return;
    e.preventDefault();
    if (canUndo) undo();
  }

  function confirmClear() {
    setConfirming(false);
    clear();
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Ctrl/Cmd+Z bubbling from the canvas and toolbar (FR-13)
    <div className={styles.board} onKeyDown={onKeyDown}>
      {!readOnly && (
        <Toolbar label="Sketch tools">
          <div className={styles.toolbar}>
            <div className={styles.group}>
              {TOOLS.map((t) => (
                <IconButton
                  key={t.tool}
                  icon={t.icon}
                  label={withState(t.name, tool === t.tool)}
                  toggled={tool === t.tool}
                  className={styles.tool}
                  onClick={() => setTool(t.tool)}
                />
              ))}
            </div>
            <div className={styles.group}>
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={withState(colourName(c), color === c)}
                  aria-pressed={color === c}
                  className={styles.swatch}
                  onClick={() => setColor(c)}
                >
                  <span
                    data-v2-exempt
                    className={styles.chip}
                    style={{ background: `var(--sketch-${c})` }}
                  />
                </button>
              ))}
            </div>
            <div className={styles.group}>
              <Button
                icon="undo"
                disabled={!canUndo}
                aria-describedby={canUndo ? undefined : undoReasonId}
                onClick={undo}
              >
                Undo
              </Button>
              <span id={undoReasonId} className={styles.hidden}>
                {NOTHING_TO_UNDO}
              </span>
              <Button icon="trash" onClick={() => setConfirming(true)}>
                Clear
              </Button>
            </div>
          </div>
        </Toolbar>
      )}
      {!readOnly && full && <InlineMessage id={fullId}>{FULL_MESSAGE}</InlineMessage>}
      <SketchCanvas visible={visible} add={add} tool={tool} color={color} readOnly={readOnly} />
      <div data-testid="sketch-live" aria-live="polite" className={styles.hidden}>
        {announcement}
      </div>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Clear the sketch?"
        footer={
          <>
            <Button ref={cancelRef} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmClear}>
              Clear for everyone
            </Button>
          </>
        }
      >
        <p>This empties the board for everyone in the session.</p>
      </Dialog>
    </div>
  );
}
