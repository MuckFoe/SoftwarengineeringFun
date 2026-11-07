import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { navigateOptions } from "./Menu";
import "./menu.css";

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  label: string;
  value: string;
  onChange(value: string): void;
  options: SelectOption[];
  error?: string;
  disabled?: boolean;
  id?: string;
}

/** Underline select (plan 1.7): a combobox trigger and a listbox panel on the Menu styling. */
export function Select({ label, value, onChange, options, error, disabled, id }: Props) {
  const ownId = useId();
  const triggerId = id ?? `${ownId}-trigger`;
  const listId = `${ownId}-list`;
  const errorId = `${ownId}-error`;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const el =
      panel.current?.querySelector<HTMLElement>("[aria-selected='true']") ??
      panel.current?.querySelector<HTMLElement>("[data-ui-option]");
    el?.focus();
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
    else navigateOptions(e, panel.current);
  };

  return (
    <div className="ui-select">
      <label className="ui-select-label" htmlFor={triggerId}>
        {label}
      </label>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        role="combobox"
        className="ui-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{current?.label ?? ""}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          ref={panel}
          id={listId}
          role="listbox"
          aria-label={label}
          className="ui-menu-panel"
          style={{ top: "auto" }}
          onKeyDown={onKeyDown}
        >
          {options.map((o) => (
            <div
              key={o.value}
              role="option"
              data-ui-option
              tabIndex={-1}
              aria-selected={o.value === value}
              className="ui-menu-option"
              onClick={() => {
                onChange(o.value);
                close();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onChange(o.value);
                  close();
                }
              }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
      {error && (
        <span id={errorId} className="ui-select-error">
          {error}
        </span>
      )}
    </div>
  );
}
