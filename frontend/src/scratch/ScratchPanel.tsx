import { useEffect, useState } from "react";
import styles from "./ScratchPanel.module.css";
import type { RunStatus, ScratchState } from "./scratchReducer";
import { visibleText } from "./visibleText";

const STATUS_TEXT: Record<RunStatus, string> = {
  running: "running…",
  finished: "finished",
  error: "error",
  time_limit: "stopped: time limit",
  output_limit: "stopped: output limit",
  interrupted: "stopped: interrupted",
};

export type ScratchPanelProps = {
  state: ScratchState;
  stale: boolean;
  onRun: (input: string) => void;
};

export function ScratchPanel({ state, stale, onRun }: ScratchPanelProps) {
  const { run } = state;
  const [input, setInput] = useState(run?.input ?? "");
  const lastInput = run?.input;
  useEffect(() => {
    if (lastInput !== undefined) setInput(lastInput);
  }, [lastInput]);
  const running = run?.status === "running";

  return (
    <section className={styles.panel} aria-label="Run with your own input">
      <label className={styles.label}>
        Input
        <textarea
          className={styles.input}
          value={input}
          rows={3}
          spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
        />
      </label>
      {!stale && (
        <button type="button" disabled={running} onClick={() => onRun(input)}>
          Run
        </button>
      )}
      {run && (
        <p role="status" className={styles.status} data-status={run.status}>
          {STATUS_TEXT[run.status]} · started by {visibleText(run.started_by)}
        </p>
      )}
      {state.notice?.reason === "in_progress" && (
        <p role="alert" className={styles.notice}>
          A run started by {visibleText(state.notice.by)} is already in progress.
        </p>
      )}
      <pre className={styles.output} data-testid="scratch-output">
        {run?.output.map((seg, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are append-only
            key={i}
            className={seg.s === "err" ? styles.err : styles.out}
            data-stream={seg.s}
          >
            {seg.s === "err" && <span className={styles.marker}>{"stderr ▸ "}</span>}
            {visibleText(seg.t)}
          </span>
        ))}
      </pre>
    </section>
  );
}
