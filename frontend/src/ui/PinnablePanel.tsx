import {
  type CSSProperties,
  type FocusEvent,
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { collapsedProps } from "./collapse";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./IconButton";
import styles from "./PinnablePanel.module.css";

/** The side the panel sits on; a strip on that edge, its peek opening away from it. */
export type PinEdge = "left" | "right" | "top" | "bottom";

/** Hovering the strip this long opens the peek, so a pointer passing over it does not. */
export const PEEK_OPEN_DELAY_MS = 120;
/** Leaving the strip and the peek this long closes it, so a pointer slipping off does not. */
export const PEEK_CLOSE_DELAY_MS = 300;

const DEFAULT_SIZE: Record<PinEdge, string> = {
  left: "220px",
  right: "320px",
  top: "220px",
  bottom: "220px",
};

export interface PinnablePanelProps {
  /** Shown in the header and on the strip; the strip's accessible name. */
  title: string;
  edge: PinEdge;
  pinned: boolean;
  onPinnedChange(pinned: boolean): void;
  children: ReactNode;
  /** The noun in "Pin …" / "Unpin …"; default the title in lower case. */
  pinLabel?: string;
  /** A glyph on the strip, before the title. */
  icon?: IconName;
  /** Extra header controls between the title and the pin, such as tabs. */
  actions?: ReactNode;
  /**
   * Width (left/right) or height (top/bottom) as a CSS length: of the pinned panel, and of
   * its peek. Default 220px, 320px on the right.
   */
  size?: string;
  /**
   * "self" (default): the panel takes `size` when pinned and its peek is placed against its
   * own strip. "parent": the panel fills its container when pinned and its peek is placed
   * against the nearest positioned ancestor (used by `PinnableColumn`).
   */
  anchor?: "self" | "parent";
  /** Expose the panel (header and body) as a region named by its title, such as "Run results". */
  region?: boolean;
  className?: string;
}

export interface PinnablePanelHandle {
  /** Opens the peek of an unpinned panel (a run showing its output); nothing when pinned. */
  peek(): void;
  /** Closes the peek. */
  close(): void;
}

/**
 * A panel that is either pinned (laid out, a header with its title and a pin toggle) or
 * unpinned: a thin labelled strip on its edge whose peek opens over the content beside it on
 * hover, focus, click or Enter, and closes after the pointer leaves (unless focus is inside),
 * on Escape (focus back to the strip), on a press outside or when focus leaves. The content
 * stays mounted throughout, so pinning, unpinning and peeking keep its state.
 */
export const PinnablePanel = forwardRef<PinnablePanelHandle, PinnablePanelProps>(
  function PinnablePanel(
    {
      title,
      edge,
      pinned,
      onPinnedChange,
      children,
      pinLabel,
      icon,
      actions,
      size,
      anchor = "self",
      region = false,
      className,
    },
    ref,
  ) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const stripRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hovered = useRef(false);
    /** The strip was focused by a press (not the keyboard): leaving with the pointer still closes. */
    const pressed = useRef(false);
    /** Focus is moving to the strip on purpose (Escape, unpin): do not open the peek for it. */
    const quietFocus = useRef(false);
    /** The strip's focus came from the keyboard, so the peek stays open while it has it. */
    const keyboardOnStrip = useRef(false);
    /** peek() came with this render, perhaps with an unpin (a shortcut): keep the peek open. */
    const peekRequested = useRef(false);
    const panelId = useId();
    const titleId = useId();
    const noun = pinLabel ?? title.toLowerCase();
    const peeking = !pinned && open;

    const clearTimer = useCallback(() => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    }, []);

    useEffect(() => clearTimer, [clearTimer]);

    useImperativeHandle(
      ref,
      () => ({
        peek: () => {
          clearTimer();
          peekRequested.current = true;
          setOpen(true);
          // Only for the render it came with.
          setTimeout(() => {
            peekRequested.current = false;
          }, 0);
        },
        close: () => {
          clearTimer();
          setOpen(false);
        },
      }),
      [clearTimer],
    );

    // Pinned, there is nothing to peek; unpinned while focus was inside, focus goes to the strip.
    // Unpinned together with peek() (a shortcut), it opens as a peek and focus stays put.
    useLayoutEffect(() => {
      clearTimer();
      if (peekRequested.current && !pinned) {
        peekRequested.current = false;
        return;
      }
      setOpen(false);
      if (!pinned && panelRef.current?.contains(document.activeElement)) {
        quietFocus.current = true;
        stripRef.current?.focus();
      }
    }, [pinned, clearTimer]);

    // A press anywhere outside closes the peek (touch has no pointer leaving).
    useEffect(() => {
      if (!peeking) return;
      function onDown(e: PointerEvent) {
        if (!rootRef.current?.contains(e.target as Node)) {
          clearTimer();
          setOpen(false);
        }
      }
      // Escape with focus elsewhere (a peek opened by a shortcut or a run) closes it too.
      function onKey(e: globalThis.KeyboardEvent) {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        clearTimer();
        setOpen(false);
      }
      document.addEventListener("pointerdown", onDown);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("pointerdown", onDown);
        document.removeEventListener("keydown", onKey);
      };
    }, [peeking, clearTimer]);

    function focusHeld(): boolean {
      const active = document.activeElement;
      if (panelRef.current?.contains(active)) return true;
      return active === stripRef.current && keyboardOnStrip.current;
    }

    function onStripEnter() {
      hovered.current = true;
      clearTimer();
      if (open) return;
      timer.current = setTimeout(() => setOpen(true), PEEK_OPEN_DELAY_MS);
    }

    function onRootEnter() {
      hovered.current = true;
      // Back over the peek before it closed: keep it.
      if (open) clearTimer();
    }

    function onRootLeave() {
      hovered.current = false;
      clearTimer();
      if (!open) return;
      timer.current = setTimeout(() => {
        if (!focusHeld()) setOpen(false);
      }, PEEK_CLOSE_DELAY_MS);
    }

    function onStripFocus() {
      keyboardOnStrip.current = !pressed.current;
      pressed.current = false;
      if (quietFocus.current) {
        quietFocus.current = false;
        return;
      }
      clearTimer();
      setOpen(true);
    }

    function onRootBlur(e: FocusEvent<HTMLDivElement>) {
      if ((e.target as Node) === stripRef.current) keyboardOnStrip.current = false;
      const next = e.relatedTarget as Node | null;
      if (next && rootRef.current?.contains(next)) return;
      // Focus left the panel; a pointer still over it keeps it open until it leaves.
      if (!hovered.current) {
        clearTimer();
        setOpen(false);
      }
    }

    function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
      // Content that handled Escape itself (a note field, a menu) keeps it.
      if (e.key !== "Escape" || !peeking || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      clearTimer();
      setOpen(false);
      quietFocus.current = true;
      keyboardOnStrip.current = true;
      stripRef.current?.focus();
    }

    const style = { "--pin-size": size ?? DEFAULT_SIZE[edge] } as CSSProperties;

    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: hover and Escape for the strip and its peek, both operable controls inside
      <div
        ref={rootRef}
        className={[styles.root, className].filter(Boolean).join(" ")}
        data-edge={edge}
        data-pinned={pinned}
        data-anchor={anchor}
        style={style}
        onPointerEnter={onRootEnter}
        onPointerLeave={onRootLeave}
        onBlur={onRootBlur}
        onKeyDown={onKeyDown}
      >
        {!pinned && (
          <button
            ref={stripRef}
            type="button"
            className={styles.strip}
            aria-expanded={open}
            aria-controls={panelId}
            onPointerEnter={onStripEnter}
            onPointerDown={() => {
              pressed.current = true;
            }}
            onFocus={onStripFocus}
            onClick={() => {
              clearTimer();
              setOpen(true);
            }}
          >
            {icon && <Icon name={icon} />}
            <span className={styles.stripLabel}>{title}</span>
          </button>
        )}
        <div
          ref={panelRef}
          id={panelId}
          className={styles.panel}
          {...(region ? { role: "region", "aria-labelledby": titleId } : {})}
          data-peek={pinned ? undefined : open ? "open" : "closed"}
          {...collapsedProps(pinned || open)}
        >
          <div className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {actions}
            <IconButton
              icon="pin"
              label={pinned ? `Unpin ${noun}` : `Pin ${noun}`}
              toggled={pinned}
              className={styles.pin}
              onClick={() => onPinnedChange(!pinned)}
            />
          </div>
          <div className={styles.body}>{children}</div>
        </div>
      </div>
    );
  },
);
