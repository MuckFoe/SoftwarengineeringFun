import { type KeyboardEvent, type ReactNode, useLayoutEffect, useRef } from "react";
import styles from "./Toolbar.module.css";

const ITEMS = "button:not([disabled]), input, select, a[href]";
const TEXT_ENTRY = "input, select, textarea";

/**
 * The window toolbar (FR-10) on the translucent material, following the WAI-ARIA toolbar
 * pattern (FR-21): one tab stop, arrow keys and Home/End move between items, the last
 * focused item is the stop. Popover panels opened from it are not items.
 */
export function Toolbar({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef(0);

  const items = () =>
    [...(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])].filter(
      (el) => !el.closest("[popover]"),
    );

  const applyTabStops = () => {
    const all = items();
    if (active.current >= all.length) active.current = Math.max(0, all.length - 1);
    all.forEach((el, i) => {
      el.tabIndex = i === active.current ? 0 : -1;
    });
  };

  useLayoutEffect(applyTabStops);

  function onFocus(e: React.FocusEvent) {
    const index = items().indexOf(e.target as HTMLElement);
    if (index >= 0 && index !== active.current) {
      active.current = index;
      applyTabStops();
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.matches(TEXT_ENTRY) || target.closest("[popover]")) return;
    const all = items();
    const from = all.indexOf(target);
    if (from < 0) return;
    const to = {
      ArrowRight: (from + 1) % all.length,
      ArrowLeft: (from - 1 + all.length) % all.length,
      Home: 0,
      End: all.length - 1,
    }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    all[to]?.focus();
  }

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      tabIndex={-1}
      className={`${styles.toolbar} material`}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
