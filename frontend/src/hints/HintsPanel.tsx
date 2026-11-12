import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Hint, HintPending } from "../api/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { TextField } from "../ui/TextField";
import styles from "./HintsPanel.module.css";

export type HintNotice = "unavailable" | "withheld" | "in_progress";

export interface HintsPanelProps {
  /** Already filtered to the current problem, by number. */
  hints: Hint[];
  /** enabled && !stale && !problem.deleted (spec 020 FR-1–FR-3). */
  canAsk: boolean;
  /** A hint being prepared, with who asked (FR-5, FR-8); `warming` → the warming-up state (FR-14a). */
  pending: HintPending | null;
  notice: HintNotice | null;
  onAsk(note: string): void;
}

const NOTE_MAX = 200;
const WARMING = "Model is warming up. This hint takes longer.";
const NOTICE_TEXT: Record<HintNotice, string> = {
  unavailable: "Hints are unavailable right now",
  withheld: "No hint could be given this time",
  in_progress: "A hint is already being prepared",
};

/** The note is one line: line breaks become spaces, then it is cut to 200 characters (FR-5). */
export function oneLine(raw: string): string {
  return raw
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim()
    .slice(0, NOTE_MAX);
}

/** The body as text nodes; a `code span` becomes a <code> text node. Never parsed as HTML (AC-15). */
function bodyText(body: string): ReactNode[] {
  return body.split(/(`[^`\n]+`)/).map((part, i) => {
    const key = `${i}:${part}`;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

/** What the polite live region says after a prop change, or null to keep the last announcement. */
function announcementFor(
  prev: { pending: HintPending | null; notice: HintNotice | null; ids: Set<string> },
  next: { pending: HintPending | null; notice: HintNotice | null; hints: Hint[] },
): string | null {
  const fresh = next.hints.filter((h) => !prev.ids.has(h.id));
  if (fresh.length > 0 && (prev.pending || next.pending)) {
    return `Hint ${Math.max(...fresh.map((h) => h.number))} ready`;
  }
  if (
    next.notice !== prev.notice &&
    (next.notice === "unavailable" || next.notice === "withheld")
  ) {
    return NOTICE_TEXT[next.notice];
  }
  if (next.pending && !prev.pending) {
    return next.pending.warming ? WARMING : `Preparing a hint for ${next.pending.by}`;
  }
  if (next.pending?.warming && prev.pending && !prev.pending.warming) return WARMING;
  return null;
}

/** Model hints beside the current problem, the Hint action and its note (spec 020). */
export function HintsPanel({ hints, canAsk, pending, notice, onAsk }: HintsPanelProps) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const hintButton = useRef<HTMLButtonElement>(null);
  const noteBox = useRef<HTMLDivElement>(null);
  const prev = useRef({ pending, notice, ids: new Set(hints.map((h) => h.id)) });
  const baseId = useId();

  useEffect(() => {
    const said = announcementFor(prev.current, { pending, notice, hints });
    if (said !== null) setAnnouncement(said);
    prev.current = { pending, notice, ids: new Set(hints.map((h) => h.id)) };
  }, [pending, notice, hints]);

  useEffect(() => {
    if (asking) noteBox.current?.querySelector("input")?.focus();
  }, [asking]);

  if (!canAsk && hints.length === 0) return null;

  const close = () => {
    setAsking(false);
    setNote("");
    hintButton.current?.focus();
  };
  const send = () => {
    onAsk(oneLine(note));
    close();
  };
  const onNoteKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      send();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className={styles.panel}>
      {canAsk && (
        <div className={styles.ask}>
          <Button
            ref={hintButton}
            variant="secondary"
            size="xs"
            disabled={pending !== null}
            aria-expanded={asking}
            onClick={() => setAsking(true)}
          >
            Hint
          </Button>
          {asking && (
            // biome-ignore lint/a11y/noStaticElementInteractions: catches Enter and Escape from the note field inside
            <div ref={noteBox} className={styles.note} onKeyDown={onNoteKey}>
              <TextField
                label="What are you stuck on? (optional)"
                value={note}
                onChange={(value) => setNote(value.replace(/[\r\n]+/g, " "))}
                maxLength={NOTE_MAX}
              />
              <div className={styles.actions}>
                <Button variant="secondary" size="xs" onClick={send}>
                  Ask
                </Button>
                <Button variant="tertiary" size="xs" onClick={close}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {pending && (
        <div className={styles.pending}>
          <p className={styles.line}>{pending.warming ? WARMING : "Preparing hint…"}</p>
          <p className={styles.meta}>
            Asked by {pending.by}
            {pending.note && <span className={styles.quote}> · {pending.note}</span>}
          </p>
        </div>
      )}
      {notice && <p className={styles.notice}>{NOTICE_TEXT[notice]}</p>}
      {hints.length > 0 && (
        <ol className={styles.list}>
          {hints.map((h) => {
            const headingId = `${baseId}-hint-${h.id}`;
            return (
              <li key={h.id}>
                <Card role="article" aria-labelledby={headingId} className={styles.hint}>
                  <p className={styles.label}>Model hint</p>
                  <h3 id={headingId} className={styles.heading}>
                    Hint {h.number}
                  </h3>
                  <p className={styles.meta}>
                    Asked by {h.asked_by}
                    {h.note && (
                      <span className={styles.quote} data-hint-note="">
                        {" "}
                        · {h.note}
                      </span>
                    )}
                  </p>
                  <p className={styles.body}>{bodyText(h.body)}</p>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
      <p className={styles.visuallyHidden} role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
