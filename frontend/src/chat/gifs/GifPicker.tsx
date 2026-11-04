import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "../../ui/Button";
import { SearchField } from "../../ui/SearchField";
import { GifImage } from "./GifImage";
import styles from "./GifPicker.module.css";
import { markNoticeSeen, noticeSeen } from "./gifNotice";
import { type GifSearchStatus, type GifSearchTransport, useGifSearch } from "./useGifSearch";

/** Cells per grid row; `GifPicker.module.css` lays the grid out with the same count. */
const COLUMNS = 3;

function statusText(status: GifSearchStatus, retryAfter: number | null, count: number): string {
  switch (status) {
    case "loading":
      return "Loading";
    case "unavailable":
      return "GIF search unavailable";
    case "rate_limited":
      return retryAfter === null
        ? "Too many searches — wait a moment"
        : `Too many searches — wait ${retryAfter} s`;
    case "results":
      return count === 0 ? "No GIFs found" : "";
    default:
      return "";
  }
}

/**
 * The GIF picker's panel (spec 007 plan, Frontend — `chat/gifs/GifPicker.tsx`). The first
 * time it opens for an invite it shows only the third-party notice; nothing is searched until
 * *Continue* (FR-5). Then: a search field, a `listbox` grid of results driven by
 * `aria-activedescendant`, "Powered by GIPHY" (FR-11) and a polite status line (FR-9, NFR-3).
 * `Enter` on the grid picks, `Escape` anywhere closes (NFR-6).
 */
export function GifPicker({
  invite,
  provider,
  onPick,
  onClose,
}: {
  invite: string;
  provider: GifSearchTransport | null;
  onPick(gifId: string): void;
  onClose(): void;
}) {
  const [seen, setSeen] = useState(() => noticeSeen(invite));
  const { query, setQuery, status, results, retryAfter } = useGifSearch({
    provider,
    enabled: seen,
  });
  const [active, setActive] = useState<number | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const id = useId();
  const optionId = (i: number) => `${id}-gif-${i}`;

  useEffect(() => {
    if (seen) field.current?.focus();
    else notice.current?.querySelector("button")?.focus();
  }, [seen]);

  // A new result set starts with nothing active.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever results change
  useEffect(() => setActive(null), [results]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const onFieldKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" || results.length === 0) return;
    e.preventDefault();
    setActive(0);
    grid.current?.focus();
  };

  const onGridKeyDown = (e: KeyboardEvent) => {
    const last = results.length - 1;
    const i = active ?? 0;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
        next = Math.min(i + 1, last);
        break;
      case "ArrowLeft":
        next = Math.max(i - 1, 0);
        break;
      case "ArrowDown":
        next = Math.min(i + COLUMNS, last);
        break;
      case "ArrowUp":
        if (i < COLUMNS) {
          e.preventDefault();
          setActive(null);
          field.current?.focus();
          return;
        }
        next = i - COLUMNS;
        break;
      case "Enter": {
        const gif = results[i];
        if (gif) {
          e.preventDefault();
          onPick(gif.id);
        }
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    setActive(next);
  };

  if (!seen) {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: Escape handler for the whole panel
      <div ref={notice} className={styles.picker} onKeyDown={onKeyDown}>
        <p className={styles.notice}>
          GIF search sends your search terms to GIPHY, a third-party service.
        </p>
        <Button
          variant="primary"
          onClick={() => {
            markNoticeSeen(invite);
            setSeen(true);
          }}
        >
          Continue
        </Button>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape handler for the whole panel
    <div className={styles.picker} onKeyDown={onKeyDown}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrows from the field into the grid */}
      <div onKeyDown={onFieldKeyDown}>
        <SearchField
          ref={field}
          label="Search GIFs"
          placeholder="Search GIPHY"
          value={query}
          onChange={setQuery}
        />
      </div>
      <div
        ref={grid}
        role="listbox"
        aria-label="GIFs"
        tabIndex={results.length > 0 ? 0 : -1}
        aria-activedescendant={active === null ? undefined : optionId(active)}
        className={styles.grid}
        onKeyDown={onGridKeyDown}
      >
        {results.map((gif, i) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles keys via aria-activedescendant
          <div
            key={gif.id}
            id={optionId(i)}
            role="option"
            tabIndex={-1}
            aria-selected={i === active}
            className={styles.cell}
            onClick={() => onPick(gif.id)}
          >
            <GifImage gif={gif} />
          </div>
        ))}
      </div>
      <div className={styles.footer}>
        <p role="status" aria-live="polite" className={styles.status}>
          {statusText(status, retryAfter, results.length)}
        </p>
        <p className={styles.attribution}>Powered by GIPHY</p>
      </div>
    </div>
  );
}
