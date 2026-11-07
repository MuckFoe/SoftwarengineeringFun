import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import "./menu.css";

export interface MenuItem {
  label: string;
  onSelect(): void;
  disabled?: boolean;
}

/** Moves focus among the enabled option buttons of a panel; returns true if it handled the key. */
export function navigateOptions(e: KeyboardEvent, panel: HTMLElement | null): boolean {
  if (!panel) return false;
  const opts = [
    ...panel.querySelectorAll<HTMLElement>("[data-ui-option]:not([aria-disabled='true'])"),
  ];
  if (!opts.length) return false;
  const i = opts.indexOf(document.activeElement as HTMLElement);
  const go = (n: number) => {
    e.preventDefault();
    opts[(n + opts.length) % opts.length]?.focus();
  };
  if (e.key === "ArrowDown") go(i + 1);
  else if (e.key === "ArrowUp") go(i < 0 ? opts.length - 1 : i - 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(opts.length - 1);
  else return false;
  return true;
}

interface Props {
  /** Names and labels the trigger button. */
  label: ReactNode;
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string;
  items: MenuItem[];
}

export function Menu({ label, ariaLabel, items }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open)
      panel.current
        ?.querySelector<HTMLElement>("[data-ui-option]:not([aria-disabled='true'])")
        ?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
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
    else if (
      e.key === "Enter" &&
      e.target instanceof HTMLElement &&
      e.target.getAttribute("role") === "menuitem"
    ) {
      e.preventDefault();
      e.target.click();
    } else navigateOptions(e, panel.current);
  };

  return (
    <div className="ui-menu">
      <button
        ref={trigger}
        type="button"
        className="ui-menu-option"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div ref={panel} id={id} role="menu" className="ui-menu-panel" onKeyDown={onKeyDown}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              data-ui-option
              tabIndex={-1}
              aria-disabled={it.disabled || undefined}
              className="ui-menu-option"
              onClick={() => {
                if (it.disabled) return;
                it.onSelect();
                close();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
