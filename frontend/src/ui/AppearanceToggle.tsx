import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../brand/Icon";
import { useShortcut } from "../shortcuts/useShortcut";
import type { Choice } from "../theme/appearance";
import { useAppearance } from "../theme/useAppearance";
import { navigateOptions } from "./Menu";
import "./menu.css";
import "./appHeader.css";

const OPTIONS: { value: Choice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

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
  useShortcut("appearance", () => setOpen(true));

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
    else navigateOptions(e, panel.current);
  };

  return (
    <div className="ui-menu">
      <button
        ref={trigger}
        type="button"
        className="app-header-icon"
        aria-label="Appearance"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={resolved === "dark" ? "moon" : "sun"} />
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="menu"
          aria-label="Appearance"
          className="ui-menu-panel app-header-menu"
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
              className="ui-menu-option"
              onClick={() => {
                setChoice(o.value);
                close();
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
