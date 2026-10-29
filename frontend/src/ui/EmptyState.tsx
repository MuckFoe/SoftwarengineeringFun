import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";
import { Icon, type IconName } from "./Icon";

interface Props {
  icon: IconName;
  title: string;
  /** A link or button, such as back to the problem list (FR-13). */
  action?: ReactNode;
  children?: ReactNode;
}

export function EmptyState({ icon, title, action, children }: Props) {
  return (
    <div className={styles.empty}>
      <span className={styles.icon}>
        <Icon name={icon} size={40} />
      </span>
      <h1 className={styles.title}>{title}</h1>
      {children && <p className={styles.text}>{children}</p>}
      {action}
    </div>
  );
}
