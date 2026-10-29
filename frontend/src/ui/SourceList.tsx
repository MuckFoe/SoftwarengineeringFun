import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import styles from "./SourceList.module.css";

interface Props<T extends { id: string }> {
  label: string;
  items: readonly T[];
  selectedId?: string;
  /** Return or click on a row. */
  onActivate(item: T): void;
  renderItem(item: T): ReactNode;
}

const LEAVE_MS = 150;

/**
 * A sidebar source list (FR-9, FR-21): a listbox with roving tabindex. Arrow keys and
 * Home/End move focus, Return activates, the selected row uses the accent. Rows fade in
 * and out (FR-4); a removed row stays for its exit animation, hidden from assistive tech.
 */
export function SourceList<T extends { id: string }>({
  label,
  items,
  selectedId,
  onActivate,
  renderItem,
}: Props<T>) {
  const [focusedId, setFocusedId] = useState<string | undefined>(undefined);
  const rows = useRef(new Map<string, HTMLDivElement | null>());
  const leaving = useLeaving(items);

  const stopId =
    (focusedId && items.some((i) => i.id === focusedId) && focusedId) ||
    (selectedId && items.some((i) => i.id === selectedId) && selectedId) ||
    items[0]?.id;

  function onKeyDown(e: KeyboardEvent, index: number) {
    const item = items[index];
    if (!item) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onActivate(item);
      return;
    }
    const to = {
      ArrowDown: Math.min(index + 1, items.length - 1),
      ArrowUp: Math.max(index - 1, 0),
      Home: 0,
      End: items.length - 1,
    }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = items[to];
    if (!next) return;
    setFocusedId(next.id);
    rows.current.get(next.id)?.focus();
  }

  const display: { item: T; leaving: boolean }[] = items.map((item) => ({ item, leaving: false }));
  for (const { item, index } of leaving) {
    display.splice(Math.min(index, display.length), 0, { item, leaving: true });
  }

  return (
    <div role="listbox" aria-label={label} className={styles.list}>
      {display.map(({ item, leaving: isLeaving }) => {
        if (isLeaving) {
          return (
            <div key={`leaving-${item.id}`} aria-hidden className={`${styles.row} anim-row-out`}>
              {renderItem(item)}
            </div>
          );
        }
        const index = items.indexOf(item);
        const selected = item.id === selectedId;
        return (
          <div
            key={item.id}
            ref={(el) => {
              rows.current.set(item.id, el);
            }}
            role="option"
            aria-selected={selected}
            tabIndex={item.id === stopId ? 0 : -1}
            className={`${styles.row} anim-row-in`}
            onFocus={() => setFocusedId(item.id)}
            onClick={() => onActivate(item)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            {renderItem(item)}
          </div>
        );
      })}
    </div>
  );
}

/** Rows removed since the last render, with their old index, kept for LEAVE_MS. */
function useLeaving<T extends { id: string }>(items: readonly T[]) {
  const previous = useRef(items);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [leaving, setLeaving] = useState<{ item: T; index: number }[]>([]);

  useEffect(() => {
    const now = new Set(items.map((i) => i.id));
    const removed = previous.current
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !now.has(item.id));
    previous.current = items;
    if (removed.length === 0) return;
    setLeaving((current) => [...current, ...removed]);
    // Not cleared when items change again: each removal finishes its own exit.
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setLeaving((current) => current.filter((l) => !removed.includes(l)));
    }, LEAVE_MS);
    timers.current.add(timer);
  }, [items]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
    };
  }, []);

  return leaving;
}
