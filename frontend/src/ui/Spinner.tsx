import styles from "./Spinner.module.css";

interface Props {
  /** What is in progress; the spinner's accessible name. */
  label: string;
  size?: number;
}

/** An indeterminate progress indicator (FR-3); stroke 1/2/3 px by size (Audi progress indicator). */
export function Spinner({ label, size = 14 }: Props) {
  return (
    <span
      role="progressbar"
      aria-label={label}
      className={styles.spinner}
      style={{ width: size, height: size, borderWidth: size <= 16 ? 1 : size <= 32 ? 2 : 3 }}
    />
  );
}
