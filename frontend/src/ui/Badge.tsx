import styles from "./chips.module.css";

interface Props {
  kind: "dot" | "count" | "alert";
  value?: number | string;
  /** Accessible name; a dot has no text so it needs one. */
  label?: string;
}

export function Badge({ kind, value, label }: Props) {
  if (kind === "dot")
    return <span role="img" aria-label={label} className={`${styles.badge} ${styles.dot}`} />;
  const cls = `${styles.badge} ${styles[kind]}`;
  if (label)
    return (
      <span role="img" aria-label={label} className={cls}>
        {value}
      </span>
    );
  return <span className={cls}>{value}</span>;
}
