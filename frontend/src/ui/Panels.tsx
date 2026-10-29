import type { ReactNode } from "react";
import { collapsedProps } from "./collapse";
import styles from "./Panels.module.css";

interface Props {
  open: boolean;
  label: string;
  children: ReactNode;
}

/** The right-hand inspector, 320 px wide; collapses by width. */
export function Inspector({ open, label, children }: Props) {
  return (
    <aside
      aria-label={label}
      className={`${styles.inspector} motion-collapse`}
      data-open={open}
      {...collapsedProps(open)}
    >
      <div className={styles.inspectorContent}>{children}</div>
    </aside>
  );
}

/** The panel under the main area, such as run results (FR-10); collapses by height. */
export function BottomPanel({ open, label, children }: Props) {
  return (
    <section
      aria-label={label}
      className={`${styles.bottom} motion-collapse`}
      data-open={open}
      {...collapsedProps(open)}
    >
      <div className={styles.bottomContent}>{children}</div>
    </section>
  );
}
