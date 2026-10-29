import type { ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./InlineMessage.module.css";

interface Props {
  /** Referenced by the affected control's aria-describedby (FR-3, AC-4). */
  id: string;
  tone?: "error" | "info";
  children: ReactNode;
}

/** A message shown next to the control it is about. Errors are announced as alerts. */
export function InlineMessage({ id, tone = "error", children }: Props) {
  return (
    <div
      id={id}
      role={tone === "error" ? "alert" : "status"}
      className={`${styles.message} ${styles[tone]}`}
    >
      {tone === "error" && <Icon name="exclamation" size={14} />}
      <span>{children}</span>
    </div>
  );
}
