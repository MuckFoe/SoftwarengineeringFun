import type { Outcome, ProblemProgress } from "../api/types";

const OUTCOME_LABEL: Record<Outcome, string> = {
  passed: "passed",
  wrong_answer: "wrong answer",
  error: "error",
  time_limit_exceeded: "time limit exceeded",
  memory_limit_exceeded: "memory limit exceeded",
};

interface Props {
  /** A run is in progress in this session (FR-26). */
  running: boolean;
  /** The current problem has been deleted (FR-10). */
  deleted: boolean;
  /** This session's accepted status and last run on the current problem. */
  progress: ProblemProgress;
  /** Why the last action had no result, e.g. a failed run. */
  notice: string | null;
  onRun: () => void;
}

/** Run button, results and the accepted badge (FR-10, FR-21, FR-22, FR-23, FR-26). */
export function RunPanel({ running, deleted, progress, notice, onRun }: Props) {
  const result = progress.last_run;
  return (
    <section>
      <button type="button" disabled={running || deleted} onClick={onRun}>
        Run
      </button>
      {running && <p>Running…</p>}
      {deleted && <p>This problem has been deleted.</p>}
      {notice && <p role="alert">{notice}</p>}
      {result && (
        <ul>
          {result.results.map((r) => (
            <li key={r.position}>
              {`Test ${r.position}: ${OUTCOME_LABEL[r.outcome]}`}
              {r.outcome === "error" && r.error_message && <span> — {r.error_message}</span>}
              {r.outcome === "error" && r.traceback && <pre>{r.traceback}</pre>}
            </li>
          ))}
        </ul>
      )}
      {progress.accepted && <p>Accepted</p>}
    </section>
  );
}
