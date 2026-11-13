import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Hint, HintPending, QuestionAwaiting } from "../api/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { TextField } from "../ui/TextField";
import styles from "./HintsPanel.module.css";

export type HintNotice = "unavailable" | "withheld" | "in_progress" | "answer_withheld";

export interface HintsPanelProps {
  /** Already filtered to the current problem, oldest first; hints and answers. */
  hints: Hint[];
  /** enabled && !stale && !problem.deleted (spec 020 FR-1–FR-3); also gates Question (FR-17). */
  canAsk: boolean;
  /** A hint or answer being prepared, with who asked (FR-5, FR-8, FR-17); `warming` (FR-14a). */
  pending: HintPending | null;
  notice: HintNotice | null;
  /** A question on this problem whose answer would reveal the solution (FR-20). */
  awaiting?: QuestionAwaiting | null;
  /** This participant's id: the confirmation is offered only when it is the asker's. */
  selfId?: string;
  /** Hint asks at once: there is no input (FR-5, changed 2026-11-13). */
  onAsk(): void;
  onQuestion?(question: string): void;
  onReveal?(): void;
  onDecline?(): void;
}

export const QUESTION_MAX = 500;
const WARMING = "Model is warming up. This hint takes longer.";
const WARMING_ANSWER = "Model is warming up. This answer takes longer.";
const warmingText = (p: HintPending) => (p.kind === "question" ? WARMING_ANSWER : WARMING);
const NOTICE_TEXT: Record<HintNotice, string> = {
  unavailable: "Hints are unavailable right now",
  withheld: "No hint could be given this time",
  answer_withheld: "No answer could be given this time",
  in_progress: "The model is already working on a request",
};

/** A question is one line: line breaks become spaces, then it is cut to 500 characters (FR-17). */
export function oneLine(raw: string, max = QUESTION_MAX): string {
  return raw
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim()
    .slice(0, max);
}

/** Inline text; a `code span` becomes a <code> text node. Never parsed as HTML (AC-15). */
function inlineText(text: string, prefix: string): ReactNode[] {
  return text.split(/(`[^`\n]+`)/).map((part, i) => {
    const key = `${prefix}:${i}:${part}`;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

/** The body as text nodes; a fenced block (a revealing answer's solution) becomes <pre>. */
function bodyText(body: string): ReactNode[] {
  return body.split(/```[^\n]*\n?([\s\S]*?)```/).map((part, i) => {
    const key = `${i}:${part}`;
    if (i % 2 === 1) {
      return (
        <pre key={key} className={styles.block}>
          <code>{part.replace(/\n$/, "")}</code>
        </pre>
      );
    }
    return <span key={key}>{inlineText(part, String(i))}</span>;
  });
}

function preparingLine(pending: HintPending): string {
  if (pending.warming) return warmingText(pending);
  if (pending.kind === "question") {
    return pending.reveal ? "Preparing the full answer…" : "Answering the question…";
  }
  return "Preparing hint…";
}

function readyText(h: Hint): string {
  return h.kind === "question" ? `Answer to question ${h.number} ready` : `Hint ${h.number} ready`;
}

type Seen = {
  pending: HintPending | null;
  notice: HintNotice | null;
  awaiting: QuestionAwaiting | null;
  ids: Set<string>;
};

/** What the polite live region says after a prop change, or null to keep the last announcement. */
function announcementFor(
  prev: Seen,
  next: Omit<Seen, "ids"> & { hints: Hint[]; mine: boolean },
): string | null {
  const fresh = next.hints.filter((h) => !prev.ids.has(h.id));
  const last = fresh[fresh.length - 1];
  if (last && (prev.pending || next.pending)) return readyText(last);
  if (next.notice !== prev.notice && next.notice && next.notice !== "in_progress") {
    return NOTICE_TEXT[next.notice];
  }
  if (next.awaiting && next.awaiting !== prev.awaiting) {
    return next.mine
      ? "The answer would give the solution away. Show it anyway?"
      : `${next.awaiting.by} is deciding whether to see the solution`;
  }
  if (next.pending && !prev.pending) {
    if (next.pending.warming) return warmingText(next.pending);
    return next.pending.kind === "question"
      ? `Answering a question from ${next.pending.by}`
      : `Preparing a hint for ${next.pending.by}`;
  }
  if (next.pending?.warming && prev.pending && !prev.pending.warming) {
    return warmingText(next.pending);
  }
  return null;
}

/** Model hints and answers beside the current problem, the Hint and Question actions (spec 020). */
export function HintsPanel({
  hints,
  canAsk,
  pending,
  notice,
  awaiting = null,
  selfId,
  onAsk,
  onQuestion,
  onReveal,
  onDecline,
}: HintsPanelProps) {
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const questionButton = useRef<HTMLButtonElement>(null);
  const questionBox = useRef<HTMLDivElement>(null);
  const prev = useRef<Seen>({ pending, notice, awaiting, ids: new Set(hints.map((h) => h.id)) });
  const baseId = useId();
  const mine = awaiting !== null && awaiting.participant_id === selfId;

  useEffect(() => {
    const said = announcementFor(prev.current, { pending, notice, awaiting, hints, mine });
    if (said !== null) setAnnouncement(said);
    prev.current = { pending, notice, awaiting, ids: new Set(hints.map((h) => h.id)) };
  }, [pending, notice, awaiting, hints, mine]);

  useEffect(() => {
    if (asking) questionBox.current?.querySelector("input")?.focus();
  }, [asking]);

  if (!canAsk && hints.length === 0) return null;

  const close = () => {
    setAsking(false);
    setQuestion("");
    questionButton.current?.focus();
  };
  const send = () => {
    const text = oneLine(question);
    if (!text) return;
    onQuestion?.(text);
    close();
  };
  const onQuestionKey = (e: KeyboardEvent<HTMLDivElement>) => {
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
          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="xs"
              disabled={pending !== null}
              onClick={() => onAsk()}
            >
              Hint
            </Button>
            {onQuestion && (
              <Button
                ref={questionButton}
                variant="secondary"
                size="xs"
                disabled={pending !== null}
                aria-expanded={asking}
                onClick={() => setAsking(true)}
              >
                Question
              </Button>
            )}
          </div>
          {asking && (
            // biome-ignore lint/a11y/noStaticElementInteractions: catches Enter and Escape from the question field inside
            <div ref={questionBox} className={styles.note} onKeyDown={onQuestionKey}>
              <TextField
                label="Your question"
                value={question}
                onChange={(value) => setQuestion(value.replace(/[\r\n]+/g, " "))}
                maxLength={QUESTION_MAX}
              />
              <div className={styles.actions}>
                <Button
                  variant="secondary"
                  size="xs"
                  disabled={!question.trim() || pending !== null}
                  onClick={send}
                >
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
          <p className={styles.line}>{preparingLine(pending)}</p>
          <p className={styles.meta}>
            Asked by {pending.by}
            {(pending.question ?? pending.note) && (
              <span className={styles.quote}> · {pending.question ?? pending.note}</span>
            )}
          </p>
        </div>
      )}
      {awaiting &&
        (mine ? (
          <section className={styles.confirm} aria-label="Answer would reveal the solution">
            <p className={styles.line}>
              The answer to “{awaiting.question}” is basically the solution. Do you really want it?
              Everyone in the session will see it.
            </p>
            <div className={styles.actions}>
              <Button variant="secondary" size="xs" disabled={pending !== null} onClick={onReveal}>
                Show the answer
              </Button>
              <Button variant="tertiary" size="xs" onClick={onDecline}>
                Keep trying
              </Button>
            </div>
          </section>
        ) : (
          <p className={styles.notice}>
            {awaiting.by} is deciding whether to see an answer that gives the solution away
          </p>
        ))}
      {notice && <p className={styles.notice}>{NOTICE_TEXT[notice]}</p>}
      {hints.length > 0 && (
        <ol className={styles.list}>
          {hints.map((h) => {
            const headingId = `${baseId}-hint-${h.id}`;
            const isAnswer = h.kind === "question";
            return (
              <li key={h.id}>
                <Card role="article" aria-labelledby={headingId} className={styles.hint}>
                  <p className={styles.label}>
                    {isAnswer ? "Model answer" : "Model hint"}
                    {h.reveals_solution && (
                      <span className={styles.reveals}> · reveals the solution</span>
                    )}
                  </p>
                  <h3 id={headingId} className={styles.heading}>
                    {isAnswer ? "Question" : "Hint"} {h.number}
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
                  {isAnswer && h.question && (
                    <p className={styles.question} data-hint-question="">
                      {h.question}
                    </p>
                  )}
                  <div className={styles.body}>{bodyText(h.body)}</div>
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
