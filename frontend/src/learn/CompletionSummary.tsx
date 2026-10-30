import styles from "./CompletionSummary.module.css";
import type { Summary } from "./learnTypes";

interface Props {
  summary: Summary;
}

/**
 * The completion summary every participant sees once the last step is passed (FR-24):
 * each step with its attempt count, who passed it, and a marker when it was passed after
 * the answer was shown. Names and titles are data, rendered as text (NFR-4).
 */
export function CompletionSummary({ summary }: Props) {
  const steps = [...summary.steps].sort((a, b) => a.position - b.position);
  return (
    <table className={styles.table} aria-label="Completion summary">
      <thead>
        <tr>
          <th scope="col">Step</th>
          <th scope="col">Attempts</th>
          <th scope="col">Passed by</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((step) => (
          <tr key={step.position}>
            <td>
              {step.position}. {step.title}
            </td>
            <td className={styles.number}>{step.attempts}</td>
            <td>
              {step.passed_by}
              {step.after_reveal && <span className={styles.revealed}>after answer shown</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
