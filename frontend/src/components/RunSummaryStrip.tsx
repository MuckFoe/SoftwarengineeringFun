import styles from "./RunSummaryStrip.module.css";
import { formatRunSummary, type RunSummary } from "./runSummary";

/** A quiet strip of the run's time, memory and examples (spec 016 FR-17). Renders nothing with no figure. */
export function RunSummaryStrip({ summary }: { summary: RunSummary }) {
  const items = formatRunSummary(summary);
  if (items.length === 0) return null;
  return (
    <dl className={styles.strip} aria-label="Run summary">
      {items.map((i) => (
        <div key={i.label} className={styles.item}>
          <dt className={styles.label}>{i.label}</dt>
          <dd className={styles.value}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
