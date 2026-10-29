import { useId } from "react";
import type { Outcome, ProblemProgress } from "../api/types";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { InlineMessage } from "../ui/InlineMessage";
import { Spinner } from "../ui/Spinner";
import styles from "./RunPanel.module.css";

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
  /** False where Run lives elsewhere, such as the session toolbar (spec 003 FR-10). */
  showRunButton?: boolean;
}

/**
 * Run button, results and the accepted badge (FR-10, FR-21, FR-22, FR-23, FR-26), as the
 * content of the session's bottom panel. While a run is in progress a spinner stands in
 * for the results at once, and the results replace it (spec 003 FR-3).
 */
export function RunPanel({
  running,
  deleted,
  progress,
  notice,
  onRun,
  showRunButton = true,
}: Props) {
  const result = progress.last_run;
  const noticeId = useId();
  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        {showRunButton && (
          <Button
            variant="primary"
            icon="play"
            busy={running}
            busyLabel="Running"
            disabled={running || deleted}
            aria-describedby={notice ? noticeId : undefined}
            onClick={onRun}
          >
            Run
          </Button>
        )}
        {progress.accepted && (
          <span className={styles.accepted}>
            <Icon name="checkmark" />
            Accepted
          </span>
        )}
      </div>
      {deleted && (
        <InlineMessage id={`${noticeId}-deleted`} tone="info">
          This problem has been deleted.
        </InlineMessage>
      )}
      {notice && <InlineMessage id={noticeId}>{notice}</InlineMessage>}
      {running ? (
        <p className={styles.running}>
          <Spinner label="Running tests" />
          Running…
        </p>
      ) : (
        result && (
          <ul className={styles.results}>
            {result.results.map((r) => (
              <li key={r.position} className={styles.result} data-outcome={r.outcome}>
                <Icon name={r.outcome === "passed" ? "checkmark" : "xmark"} />
                <span>
                  {`Test ${r.position}: ${OUTCOME_LABEL[r.outcome]}`}
                  {r.outcome === "error" && r.error_message && <span> — {r.error_message}</span>}
                </span>
                {r.outcome === "error" && r.traceback && (
                  <pre className={styles.traceback}>{r.traceback}</pre>
                )}
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}
