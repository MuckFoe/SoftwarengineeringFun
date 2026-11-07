import {
  cloneElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./Popover.module.css";
import "./overlay.css";

interface Props {
  /** Names the trigger button and the panel. */
  label: string;
  icon?: IconName;
  /** Visible trigger text; without it the trigger is icon-only, named by `label`. */
  text?: ReactNode;
  children: ReactNode;
  /** Opens or closes it from outside, such as a keyboard shortcut. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type PopoverElement = HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void };

/**
 * A popover on the HTML `popover` attribute, opened by its trigger through
 * `popovertarget`: the browser handles Esc and light dismiss. Placed under the trigger,
 * right-aligned, when it opens. Opened through `open`, it moves focus to its first control.
 */
export function Popover({ label, icon, text, children, open, onOpenChange }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<PopoverElement>(null);
  const [shown, setShown] = useState(false);
  const latestOnOpenChange = useRef(onOpenChange);
  latestOnOpenChange.current = onOpenChange;

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === "open";
      setShown(isOpen);
      latestOnOpenChange.current?.(isOpen);
      if (!isOpen || !trigger.current) return;
      const r = trigger.current.getBoundingClientRect();
      el.style.top = `${r.bottom + 4}px`;
      el.style.left = `${Math.max(8, r.right - el.offsetWidth)}px`;
    };
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, []);

  useEffect(() => {
    const el = panel.current;
    if (open === undefined || !el) return;
    setShown(open);
    if (open) {
      if (!el.matches(":popover-open")) el.showPopover?.();
      // A roving-tabindex group's current item first, else the first control.
      const target =
        el.querySelector<HTMLElement>('[tabindex="0"]') ??
        el.querySelector<HTMLElement>("button, input, a[href]");
      target?.focus();
    } else if (el.matches(":popover-open")) {
      el.hidePopover?.();
    }
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={text ? undefined : label}
        aria-haspopup="dialog"
        aria-expanded={open ?? shown}
        {...{ popovertarget: id }}
      >
        {icon && <Icon name={icon} />}
        {text}
      </button>
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-label={label}
        className={`${styles.panel} anim-popover-in`}
        {...{ popover: "auto" }}
      >
        {children}
      </div>
    </>
  );
}

/**
 * Audi tooltip (spec 015 FR-4): a short inverted label shown on hover and keyboard focus,
 * hidden on Esc. The existing `Popover` above stays the click-to-open panel.
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactElement }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: wrapper only forwards hover/focus/Esc from the child control
    <span
      className="tooltip-wrap"
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setShown(false);
      }}
    >
      {cloneElement(children, { "aria-describedby": shown ? id : undefined } as object)}
      {shown && (
        <span role="tooltip" id={id} className="tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
