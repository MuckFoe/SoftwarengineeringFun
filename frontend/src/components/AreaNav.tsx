import { Link, useLocation } from "react-router";
import { SidebarSection } from "../ui/Sidebar";
import styles from "./AreaNav.module.css";

const AREAS = [
  { to: "/", title: "Problems" },
  { to: "/learn", title: "Learn" },
] as const;

/** Under /learn is Learn; everything else (problems, coding sessions) is Problems. */
function currentArea(pathname: string): string {
  return pathname === "/learn" || pathname.startsWith("/learn/") ? "/learn" : "/";
}

/**
 * The sidebar's area switch (FR-1): Problems and Learn, the current one marked with
 * `aria-current` and the accent, like a selected source-list row.
 */
export function AreaNav() {
  const current = currentArea(useLocation().pathname);
  return (
    <SidebarSection title="Areas">
      <ul className={styles.list}>
        {AREAS.map((area) => (
          <li key={area.to}>
            <Link
              className={styles.row}
              to={area.to}
              aria-current={area.to === current ? "page" : undefined}
            >
              {area.title}
            </Link>
          </li>
        ))}
      </ul>
    </SidebarSection>
  );
}
