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
  return (
    <span aria-label={label} className={`${styles.badge} ${styles[kind]}`}>
      {value}
    </span>
  );
}
