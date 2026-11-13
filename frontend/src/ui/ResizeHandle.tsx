import { type KeyboardEvent, type PointerEvent, type RefObject, useRef } from "react";
import styles from "./ResizeHandle.module.css";

/** The edge of the screen the resized part sits on; the handle is on its opposite, inner side. */
export type ResizeEdge = "left" | "right" | "top" | "bottom";

export interface ResizeHandleProps {
  edge: ResizeEdge;
  /** The element whose width (left/right) or height (top/bottom) is changed. */
  target: RefObject<HTMLElement | null>;
  /** Its current size, px. */
  size: number;
  onResize(px: number): void;
  /** Smallest size, px. */
  minSize: number;
  /** How much of the viewport, px, is always left to the rest of the screen. */
  keepFree: number;
  /** Accessible name, e.g. "Resize sidebar". */
  label: string;
}

/** Pixels one arrow key press moves the handle. */
const KEY_STEP = 16;

/** The size kept between `minSize` and the viewport less `keepFree`. */
export function clampSize(next: number, minSize: number, keepFree: number, room: number): number {
  const max = room > 0 ? Math.max(minSize, room - keepFree) : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(next, minSize), max);
}

/**
 * A divider on the inner edge of a part laid along a screen edge (a sidebar's right, the run
 * results' top, the inspector's left). Drag it, or focus it and use the arrow keys. It must sit
 * inside a positioned ancestor (the resized part). Its line shows only on hover.
 */
export function ResizeHandle({
  edge,
  target,
  size,
  onResize,
  minSize,
  keepFree,
  label,
}: ResizeHandleProps) {
  const horizontal = edge === "left" || edge === "right";
  /** Growing direction: away from the part's screen edge. */
  const grow = edge === "left" || edge === "top" ? 1 : -1;
  /** While dragging: where the pointer went down and the size then. */
  const drag = useRef<{ at: number; size: number } | null>(null);

  function current(): number {
    const rect = target.current?.getBoundingClientRect();
    const measured = rect ? (horizontal ? rect.width : rect.height) : 0;
    return measured > 0 ? measured : size;
  }

  function resizeTo(next: number) {
    const room = horizontal ? window.innerWidth : window.innerHeight;
    onResize(clampSize(next, minSize, keepFree, room));
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    // jsdom has no pointer capture.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { at: horizontal ? e.clientX : e.clientY, size: current() };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    resizeTo(d.size + grow * ((horizontal ? e.clientX : e.clientY) - d.at));
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = horizontal
      ? { ArrowRight: KEY_STEP, ArrowLeft: -KEY_STEP }
      : { ArrowDown: KEY_STEP, ArrowUp: -KEY_STEP };
    const delta = keys[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    resizeTo(current() + grow * delta);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable, resizable splitter is a separator widget; <hr> cannot take focus or keys.
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={Math.round(size)}
      aria-valuemin={minSize}
      tabIndex={0}
      className={styles.handle}
      data-edge={edge}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={onKeyDown}
    />
  );
}
