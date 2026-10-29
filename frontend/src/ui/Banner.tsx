import type { ReactNode } from "react";
import styles from "./Banner.module.css";
import { Icon } from "./Icon";

interface Props {
  tone?: "info" | "warning";
  /** Buttons shown at the end of the banner, such as Reactivate (FR-12). */
  actions?: ReactNode;
  children: ReactNode;
}

/** A calm, full-width notice under the toolbar. */
export function Banner({ tone = "info", actions, children }: Props) {
  return (
    <div role="status" className={`${styles.banner} ${styles[tone]}`}>
      <Icon name={tone === "warning" ? "exclamation" : "doc"} />
      <div className={styles.text}>{children}</div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
