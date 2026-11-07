import styles from "./CodePreview.module.css";

export function CodePreview({ excerpt }: { excerpt?: string | null }) {
  if (!excerpt?.trim()) return null;
  return (
    <pre className={styles.preview} aria-hidden="true" tabIndex={-1}>
      {excerpt}
    </pre>
  );
}
