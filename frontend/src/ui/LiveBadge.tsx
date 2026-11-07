import styles from "./LiveBadge.module.css";

/** A pulsing dot and the word "Live". The text carries the meaning without motion. */
export function LiveBadge() {
  return (
    <span className={styles.badge}>
      <span className={styles.dot} aria-hidden="true" />
      Live
    </span>
  );
}
