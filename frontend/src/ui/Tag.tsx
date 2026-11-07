import styles from "./chips.module.css";

interface Props {
  label: string;
  selected?: boolean;
  onClick?: () => void;
}

export function Tag({ label, selected = false, onClick }: Props) {
  if (!onClick) return <span className={styles.tag}>{label}</span>;
  return (
    <button type="button" className={styles.tag} aria-pressed={selected} onClick={onClick}>
      {label}
    </button>
  );
}
