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
import { ResizeHandle } from "./ResizeHandle";

/** The side the panel sits on; unpinned, a bar on that edge whose panel opens from there. */
export type PinEdge = "left" | "right" | "top" | "bottom";

/** An open peek closes this long after the pointer has left it, unless focus is inside. */
export const PEEK_CLOSE_DELAY_MS = 2000;

const DEFAULT_SIZE: Record<PinEdge, string> = {
  left: "220px",
  right: "320px",
  top: "220px",
  bottom: "220px",
};

export interface PinnablePanelProps {
  /** Shown in the bar; the accessible name of the bar's toggle while unpinned. */
  title: string;
  edge: PinEdge;
  pinned: boolean;
  onPinnedChange(pinned: boolean): void;
  children: ReactNode;
  /** The noun in "Pin …" / "Unpin …"; default the title in lower case. */
  pinLabel?: string;
  /** A glyph in the bar, before the title. */
  icon?: IconName;
  /** Extra bar controls between the title and the pin, such as tabs; shown while open. */
  actions?: ReactNode;
  /**
   * Width (left/right) or height (top/bottom) as a CSS length: of the pinned panel, and of
   * the opened peek. Default 220px, 320px on the right.
   */
  size?: string;
  /**
   * "self" (default): the panel takes `size` when pinned and opens over its own bar.
   * "parent": the panel fills its container when pinned and opens against the nearest
   * positioned ancestor (used by `PinnableColumn`).
   */
  anchor?: "self" | "parent";
  /** Expose the shown panel as a region named by its title, such as "Run results". */
  region?: boolean;
  /**
   * Makes the pinned, self-anchored panel resizable: a divider on its inner edge (the right
   * of a left panel, the top of a bottom one) reports the new size in px. `size` should then
   * be that size in px.
   */
  onResize?(px: number): void;
  /** The smallest size the divider allows, px; default 160. */
  minSize?: number;
  /** How much of the viewport the divider always leaves to the rest, px; default 240. */
  keepFree?: number;
  /** Accessible name of the divider; default "Resize <title>". */
  resizeLabel?: string;
  className?: string;
}

export interface PinnablePanelHandle {
  /** Opens an unpinned panel (a run showing its output); nothing when pinned. */
  peek(): void;
  /** Closes it. */
  close(): void;
}

/**
 * A panel that is pinned (laid out, under its bar) or unpinned: only its bar, a thin pill on
 * its edge. Pressing the bar (click, tap, Enter, Space) opens the panel over the content
 * beside it, the same bar moving to the top as its header, with the actions and the pin.
 * Open, it closes on Escape (focus back on the bar), on a press outside, when focus leaves it,
 * and 2 s after the pointer has left it, but never while focus is inside. The content stays
 * mounted throughout, so pinning, unpinning and opening keep its state.
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
      onResize,
      minSize = 160,
      keepFree = 240,
      resizeLabel,
      className,
    },
    ref,
  ) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const toggleRef = useRef<HTMLButtonElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hovered = useRef(false);
    /** The bar's toggle got focus from a press, not the keyboard. */
    const pressed = useRef(false);
    /** The toggle's focus came from the keyboard, so the panel stays open while it has it. */
    const keyboardOnToggle = useRef(false);
    /** peek() came with this render, perhaps with an unpin (a shortcut): keep it open. */
    const peekRequested = useRef(false);
    /** Unpinned from its own pin: focus goes to the bar's toggle. */
    const focusToggle = useRef(false);
    const bodyId = useId();
    const titleId = useId();
    const noun = pinLabel ?? title.toLowerCase();
    const shown = pinned || open;
    const state = pinned ? "pinned" : open ? "open" : "closed";

    const clearTimer = useCallback(() => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    }, []);

    const close = useCallback(() => {
      clearTimer();
      setOpen(false);
    }, [clearTimer]);

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
        close,
      }),
      [clearTimer, close],
    );

    // Pinned or unpinned, it starts closed; unpinned together with peek() (a shortcut), it
    // stays open. Unpinned from its own pin, focus moves to the bar's toggle.
    useLayoutEffect(() => {
      clearTimer();
      if (peekRequested.current && !pinned) {
        peekRequested.current = false;
        return;
      }
      setOpen(false);
      if (!pinned && focusToggle.current) {
        focusToggle.current = false;
        keyboardOnToggle.current = true;
        toggleRef.current?.focus();
      }
    }, [pinned, clearTimer]);

    // Open: a press outside or an Escape anywhere closes it (touch has no pointer leaving).
    useEffect(() => {
      if (pinned || !open) return;
      function onDown(e: PointerEvent) {
        if (!rootRef.current?.contains(e.target as Node)) close();
      }
      function onKey(e: globalThis.KeyboardEvent) {
        if (e.key === "Escape" && !e.defaultPrevented) close();
      }
      document.addEventListener("pointerdown", onDown);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("pointerdown", onDown);
        document.removeEventListener("keydown", onKey);
      };
    }, [pinned, open, close]);

    /** Focus inside holds it open: anywhere in the panel, or on the toggle from the keyboard. */
    function focusHeld(): boolean {
      const active = document.activeElement;
      if (!active || !rootRef.current?.contains(active)) return false;
      return active !== toggleRef.current || keyboardOnToggle.current;
    }

    function onEnter() {
      hovered.current = true;
      clearTimer();
    }

    function onLeave() {
      hovered.current = false;
      clearTimer();
      if (pinned || !open) return;
      timer.current = setTimeout(() => {
        if (!focusHeld()) setOpen(false);
      }, PEEK_CLOSE_DELAY_MS);
    }

    function onBlur(e: FocusEvent<HTMLDivElement>) {
      if ((e.target as Node) === toggleRef.current) keyboardOnToggle.current = false;
      const next = e.relatedTarget as Node | null;
      if (next && rootRef.current?.contains(next)) return;
      // Focus left; a pointer still over it keeps it open until it leaves.
      if (!hovered.current) close();
    }

    function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
      // Content that handled Escape itself (a note field, a menu) keeps it.
      if (e.key !== "Escape" || pinned || !open || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      close();
      keyboardOnToggle.current = true;
      toggleRef.current?.focus();
    }

    const resizable = pinned && anchor === "self" && onResize !== undefined;

    const style = { "--pin-size": size ?? DEFAULT_SIZE[edge] } as CSSProperties;
    const label = (
      <>
        {icon && <Icon name={icon} />}
        <span className={styles.label}>{title}</span>
      </>
    );

    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: Escape and pointer leaving for the bar and its panel, both operable controls inside
      <div
        ref={rootRef}
        className={[styles.root, className].filter(Boolean).join(" ")}
        data-edge={edge}
        data-pinned={pinned}
        data-state={state}
        data-anchor={anchor}
        style={style}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        <div
          className={styles.panel}
          {...(region && shown ? { role: "region", "aria-labelledby": titleId } : {})}
        >
          <div className={styles.bandBar}>
            <div className={styles.bar}>
              <h2 id={titleId} className={styles.title}>
                {pinned ? (
                  <span className={styles.titleInner}>{label}</span>
                ) : (
                  <button
                    ref={toggleRef}
                    type="button"
                    className={styles.toggle}
                    aria-expanded={open}
                    aria-controls={bodyId}
                    onPointerDown={() => {
                      pressed.current = true;
                    }}
                    onFocus={() => {
                      keyboardOnToggle.current = !pressed.current;
                      pressed.current = false;
                    }}
                    onClick={() => {
                      clearTimer();
                      setOpen(!open);
                    }}
                  >
                    {label}
                  </button>
                )}
              </h2>
              {shown && actions}
              {shown && (
                <IconButton
                  icon="pin"
                  label={pinned ? `Unpin ${noun}` : `Pin ${noun}`}
                  toggled={pinned}
                  className={styles.pin}
                  onClick={() => {
                    if (pinned) focusToggle.current = true;
                    onPinnedChange(!pinned);
                  }}
                />
              )}
            </div>
          </div>
          <div id={bodyId} className={styles.body} {...collapsedProps(shown)}>
            {children}
          </div>
        </div>
        {resizable && (
          <ResizeHandle
            edge={edge}
            target={rootRef}
            size={Number.parseFloat(size ?? DEFAULT_SIZE[edge])}
            onResize={onResize}
            minSize={minSize}
            keepFree={keepFree}
            label={resizeLabel ?? `Resize ${title.toLowerCase()}`}
          />
        )}
      </div>
    );
  },
);
