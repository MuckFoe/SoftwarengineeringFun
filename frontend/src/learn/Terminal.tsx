import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { Attempt } from "./learnTypes";
import styles from "./Terminal.module.css";

interface Props {
  /** Shown before the input and used as its label. */
  prompt: string;
  /** The shared terminal history: every participant's submitted commands (FR-18, FR-12). */
  history: Attempt[];
  onSubmit(command: string): void;
  disabled?: boolean;
}

/**
 * Simulated terminal (spec 006 FR-18, NFR-1, NFR-4). The input line is local state and is
 * only handed to `onSubmit` on Enter. Everything is rendered as text, never as HTML.
 */
export function Terminal({ prompt, history, onSubmit, disabled = false }: Props) {
  const inputId = useId();
  const logRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  // Commands submitted from this input, oldest first; recalled with ↑/↓.
  const [own, setOwn] = useState<string[]>([]);
  // Position in `own` while recalling; `own.length` means the line being typed.
  const [recall, setRecall] = useState(0);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const log = logRef.current;
    if (log && history.length > 0) log.scrollTop = log.scrollHeight;
  }, [history.length]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (disabled || value.trim() === "") return;
      onSubmit(value);
      const next = [...own, value];
      setOwn(next);
      setRecall(next.length);
      setDraft("");
      setValue("");
    } else if (e.key === "ArrowUp") {
      if (recall === 0) return;
      e.preventDefault();
      if (recall === own.length) setDraft(value);
      setRecall(recall - 1);
      setValue(own[recall - 1] ?? "");
    } else if (e.key === "ArrowDown") {
      if (recall >= own.length) return;
      e.preventDefault();
      const next = recall + 1;
      setRecall(next);
      setValue(next === own.length ? draft : (own[next] ?? ""));
    }
  }

  return (
    <div className={styles.terminal}>
      <div
        ref={logRef}
        className={styles.log}
        role="log"
        aria-live="polite"
        aria-label="Terminal history"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the scrollable history must be keyboard-reachable (NFR-1, AC-27).
        tabIndex={0}
      >
        {history.map((a) => (
          <pre key={a.id} className={styles.entry}>
            <span className={styles.command}>{`${a.by} $ ${String(a.submitted)}`}</span>
            {a.output ? `\n${a.output}` : ""}
          </pre>
        ))}
      </div>
      <div className={styles.line}>
        <label className={styles.prompt} htmlFor={inputId}>
          {prompt}
        </label>
        <input
          id={inputId}
          className={styles.input}
          type="text"
          value={value}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value);
            setRecall(own.length);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
