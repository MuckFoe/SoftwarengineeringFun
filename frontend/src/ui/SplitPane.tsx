import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { collapsedProps } from "./collapse";
import styles from "./SplitPane.module.css";

export interface SplitPaneProps {
  top: ReactNode;
  bottom: ReactNode;
  /** When false only `top` is laid out; `bottom` stays mounted, collapsed to 0, aria-hidden + inert. */
  bottomOpen: boolean;
  /** Minimum height of the top part, px. */
  minTop: number;
  /** Minimum height of the bottom part, px. */
  minBottom: number;
  /** Initial share of the top part, 0..1; default 0.5. */
  defaultTopFraction?: number;
  /**
   * Until the divider is first moved, size the top part to its content instead of a share,
   * keeping at least this many px for the bottom part. Overrides `defaultTopFraction`.
   */
  fitTop?: number;
  /**
   * Until the divider is first moved, the bottom part is exactly this many px tall (so it can
   * line up with something beside it), whatever the container's height. Overrides `fitTop`
   * and `defaultTopFraction`; the minimums still apply.
   */
  fixBottom?: number;
  /** Accessible name of the divider, e.g. "Resize description and chat". */
  dividerLabel: string;
  /**
   * Stacked instead of split (pinnable panels, `PinnableColumn`): no divider, both parts stay
   * laid out and reachable. "top" or "bottom" names the part that takes only its own size (a
   * strip) while the other fills; "both" shares the height evenly. Overrides `bottomOpen`.
   * While stacked the parts do not clip, so a peek overlay can rise over the other part.
   */
  stack?: "top" | "bottom" | "both";
}

/** Pixels one arrow key press moves the divider. */
const KEY_STEP = 16;

/**
 * The top part's height, kept so that top ≥ minTop and bottom ≥ minBottom. A container
 * shorter than both minimums together is shared in proportion to them.
 */
export function clampTop(
  top: number,
  container: number,
  minTop: number,
  minBottom: number,
): number {
  if (container <= 0) return 0;
  if (container < minTop + minBottom) return (container * minTop) / (minTop + minBottom);
  return Math.min(Math.max(top, minTop), container - minBottom);
}

/** A vertical split: top part, a resizable divider, bottom part that can be collapsed. */
export function SplitPane({
  top,
  bottom,
  bottomOpen,
  minTop,
  minBottom,
  defaultTopFraction,
  fitTop,
  fixBottom,
  dividerLabel,
  stack,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  /** While dragging: where the pointer went down and the top part's height then. */
  const dragRef = useRef<{ y: number; top: number } | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  // null: not moved yet, and the top part fits its content (fitTop).
  const [topFraction, setTopFraction] = useState<number | null>(
    fitTop === undefined && fixBottom === undefined ? (defaultTopFraction ?? 0.5) : null,
  );
  // The top content's own height, whatever height it is shown at (fitTop only).
  const [content, setContent] = useState(0);

  function measureContent() {
    const part = topRef.current;
    // The scrolling element whose content decides the fit: one marked `data-fit-content` (inside
    // a pinnable panel, under its header), else the top part's own child.
    const el = part?.querySelector("[data-fit-content]") ?? part?.firstElementChild;
    if (!part || !(el instanceof HTMLElement)) return;
    const origin = part.getBoundingClientRect().top;
    let bottom = el.getBoundingClientRect().top;
    for (const child of el.children)
      bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
    const next =
      bottom - origin + el.scrollTop + Number.parseFloat(getComputedStyle(el).paddingBottom);
    setContent((now) => (Math.abs(now - next) > 1 ? next : now));
  }

  // No dependency list: re-measured after every render, since the top part's content (a problem
  // switch, a hint) comes in through props.
  useLayoutEffect(() => {
    if (fitTop !== undefined && topFraction === null) measureContent();
  });

  // Images change the content's height without a render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measureContent only reads refs.
  useEffect(() => {
    const el = topRef.current;
    if (!el || fitTop === undefined) return;
    const onLoad = () => measureContent();
    el.addEventListener("load", onLoad, true);
    return () => el.removeEventListener("load", onLoad, true);
  }, [fitTop]);
  // The height shared by the two parts: the container's, less the divider's own.
  const [height, setHeight] = useState(0);

  function measure(): number {
    const container = containerRef.current?.clientHeight ?? 0;
    return Math.max(0, container - (dividerRef.current?.offsetHeight ?? 0));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the divider comes and goes with bottomOpen and stack, changing the shared height.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setHeight(measure());
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(measure()));
    observer.observe(el);
    return () => observer.disconnect();
  }, [bottomOpen, stack]);

  // With a known height, the shown share respects both minimums even after a resize.
  const wantedTop =
    topFraction === null
      ? fixBottom !== undefined
        ? height - fixBottom
        : Math.min(content || height / 2, height - (fitTop ?? 0))
      : topFraction * height;
  const shownFraction =
    height > 0 ? clampTop(wantedTop, height, minTop, minBottom) / height : (topFraction ?? 0.5);

  function moveTo(next: number, container: number) {
    setHeight(container);
    setTopFraction(clampTop(next, container, minTop, minBottom) / container);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const container = measure();
    if (container <= 0) return;
    const current = shownFraction * container;
    let next: number;
    switch (e.key) {
      case "ArrowUp":
        next = current - KEY_STEP;
        break;
      case "ArrowDown":
        next = current + KEY_STEP;
        break;
      case "Home":
        next = minTop;
        break;
      case "End":
        next = container - minBottom;
        break;
      default:
        return;
    }
    e.preventDefault();
    moveTo(next, container);
  }

  // Pointer drag (FR-5): the top part follows the pointer, clamped, until release.
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const container = measure();
    if (container <= 0) return;
    e.preventDefault();
    // jsdom has no pointer capture.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { y: e.clientY, top: shownFraction * container };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const container = measure();
    if (container <= 0) return;
    moveTo(drag.top + e.clientY - drag.y, container);
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  const split = bottomOpen && stack === undefined;
  const topStyle = split
    ? height > 0
      ? { flexBasis: `${shownFraction * height}px` }
      : { flexBasis: `${shownFraction * 100}%` }
    : undefined;

  return (
    <div
      ref={containerRef}
      className={styles.split}
      data-bottom-open={bottomOpen || stack !== undefined}
      data-stack={stack}
    >
      <div ref={topRef} className={styles.top} style={topStyle}>
        {top}
      </div>
      {split && (
        // biome-ignore lint/a11y/useSemanticElements: a focusable, resizable splitter is a separator widget; <hr> cannot take focus or keys.
        <div
          ref={dividerRef}
          role="separator"
          aria-orientation="horizontal"
          tabIndex={0}
          aria-label={dividerLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(shownFraction * 100)}
          className={styles.divider}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        />
      )}
      <div
        className={styles.bottom}
        data-open={bottomOpen || stack !== undefined}
        {...collapsedProps(bottomOpen || stack !== undefined)}
      >
        {bottom}
      </div>
    </div>
  );
}
