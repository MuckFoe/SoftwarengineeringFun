import styles from "./ScratchPanel.module.css";
import type { Run, RunStatus, ScratchState } from "./scratchReducer";
import { visibleText } from "./visibleText";

const STATUS_TEXT: Record<RunStatus, string> = {
  running: "running…",
  finished: "finished",
  error: "error",
  time_limit: "stopped: time limit",
  output_limit: "stopped: output limit",
  interrupted: "stopped: interrupted",
};

function statusText(run: Run): string {
  const base = STATUS_TEXT[run.status];
  return run.status === "error" && run.exit_code !== null && run.exit_code !== 0
    ? `${base} (exit code ${run.exit_code})`
    : base;
}

export type ScratchPanelProps = {
  state: ScratchState;
};

/**
 * The output of the session's last script run (spec 011, as changed on 2026-11-12): status,
 * who started it, and everything it printed, errors and tracebacks included, as plain text.
 * The toolbar's Run starts it with empty input; there is no input box any more. A stored run
 * from before the change may still carry an input, which is simply not shown.
 */
export function ScratchPanel({ state }: ScratchPanelProps) {
  const { run } = state;
  return (
    <div className={styles.panel}>
      {run ? (
        <p role="status" className={styles.status} data-status={run.status}>
          {statusText(run)} · started by {visibleText(run.started_by)}
        </p>
      ) : (
        <p className={styles.empty}>
          Run your code to see its output here. Check runs the hidden tests.
        </p>
      )}
      {state.notice?.reason === "in_progress" && (
        <p role="alert" className={styles.notice}>
          A run started by {visibleText(state.notice.by)} is already in progress.
        </p>
      )}
      {run && (
        <pre className={styles.output} data-testid="scratch-output">
          {run.output.map((seg, i) => (
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
      )}
    </div>
  );
}
