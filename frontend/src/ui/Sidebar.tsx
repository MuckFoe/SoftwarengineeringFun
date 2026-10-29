import { type ReactNode, useId } from "react";
import styles from "./Sidebar.module.css";

/** The window's source-list sidebar: a navigation landmark on the translucent material. */
export function Sidebar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className={`${styles.sidebar} material`}>
      {children}
    </nav>
  );
}

/** A titled group in the sidebar, exposed as a region named by its title. */
export function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={styles.section}>
      <h2 id={id} className={styles.title}>
        {title}
      </h2>
      {children}
    </section>
  );
}
