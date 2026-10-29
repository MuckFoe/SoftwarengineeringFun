import type { ReactNode } from "react";
import { collapsedProps } from "./collapse";
import styles from "./Window.module.css";

interface Props {
  toolbar: ReactNode;
  /** Shown under the toolbar, such as the stale-session Banner. */
  banner?: ReactNode;
  sidebar?: ReactNode;
  sidebarOpen?: boolean;
  /** An Inspector; it controls its own open state. */
  inspector?: ReactNode;
  /** A BottomPanel under the main area. */
  bottomPanel?: ReactNode;
  children: ReactNode;
}

/**
 * One window per screen (FR-1, FR-10): toolbar on top, sidebar 220 px, main at least
 * 420 px, inspector 320 px and a bottom panel. Below 1200 px the sidebar overlays the main
 * area instead of pushing it (NFR-2). The sidebar comes first in the document so Tab goes
 * sidebar → toolbar → main → panels (FR-21); the grid still draws the toolbar on top.
 */
export function Window({
  toolbar,
  banner,
  sidebar,
  sidebarOpen = true,
  inspector,
  bottomPanel,
  children,
}: Props) {
  return (
    <div className={styles.window}>
      {sidebar && (
        <div
          className={`${styles.sidebar} motion-collapse`}
          data-open={sidebarOpen}
          {...collapsedProps(sidebarOpen)}
        >
          {sidebar}
        </div>
      )}
      <div className={styles.top}>
        {toolbar}
        {banner}
      </div>
      <div className={styles.center}>
        <main className={styles.main}>{children}</main>
        {bottomPanel}
      </div>
      {inspector && <div className={styles.inspector}>{inspector}</div>}
    </div>
  );
}
