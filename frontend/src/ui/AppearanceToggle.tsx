import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "../brand/Icon";
import type { BrandIconName } from "../brand/iconMap";
import { useShortcut } from "../shortcuts/useShortcut";
import type { Choice } from "../theme/appearance";
import { useAppearance } from "../theme/useAppearance";
import { navigateOptions } from "./Menu";
import "./menu.css";
import "./appHeader.css";
import "./appearanceMenu.css";

const OPTIONS: { value: Choice; label: string; icon: BrandIconName }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "circleHalf" },
];

const GAP = 4;
const EDGE = 8;

/** Places a fixed panel under its trigger, right-aligned, clamped inside the viewport. */
function place(trigger: HTMLElement, panel: HTMLElement): CSSProperties {
  const t = trigger.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  const w = p.width;
  const h = p.height;
  let left = t.right - w;
  let top = t.bottom + GAP;
  if (top + h > window.innerHeight - EDGE) top = t.top - GAP - h;
  left = Math.min(left, window.innerWidth - w - EDGE);
  top = Math.min(top, window.innerHeight - h - EDGE);
  return { left: Math.max(EDGE, left), top: Math.max(EDGE, top) };
}

/**
 * The header's appearance setting (FR-6a): Light, Dark or System, applied at once and kept in
 * this browser; System clears the stored value. Same logic as the earlier control
 * (`useAppearance`, storage key `appearance`, attribute `data-appearance`), restyled as a menu.
 * The appearance shortcut opens it.
 */
export function AppearanceToggle() {
  const { choice, resolved, setChoice } = useAppearance();
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ left: 0, top: 0 });
  useShortcut("appearance", () => setOpen(true));

  const reposition = useCallback(() => {
    if (trigger.current && panel.current) setPos(place(trigger.current, panel.current));
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const checked = panel.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    checked?.focus();
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      if (!panel.current?.contains(e.target) && !trigger.current?.contains(e.target))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") setOpen(false);
    else if (e.key === "Enter" && e.target instanceof HTMLElement) {
      e.preventDefault();
      e.target.click();
    } else navigateOptions(e, panel.current);
  };

  return (
    <div className="ui-menu">
      <button
        ref={trigger}
        type="button"
        className="app-header-pill app-header-pill-icon"
        aria-label="Appearance"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={resolved === "dark" ? "moon" : "sun"} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="menu"
            aria-label="Appearance"
            className="appearance-menu"
            style={{ position: "fixed", zIndex: "var(--z-menu)", ...pos }}
            onKeyDown={onKeyDown}
          >
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={choice === o.value}
                data-ui-option
                tabIndex={-1}
                className="appearance-menu-item"
                onClick={() => {
                  setChoice(o.value);
                  close();
                }}
              >
                <Icon name={o.icon} />
                <span className="appearance-menu-label">{o.label}</span>
                <span className="appearance-menu-check">
                  {choice === o.value && <Icon name="checkmark" />}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
