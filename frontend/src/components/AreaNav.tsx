import { Link, useLocation } from "react-router";
import { SidebarSection } from "../ui/Sidebar";
import styles from "./AreaNav.module.css";

export const AREAS = [
  { to: "/", title: "Problems" },
  { to: "/learn", title: "Learn" },
  { to: "/present", title: "Present" },
  { to: "/games", title: "Games" },
] as const;

const under = (pathname: string, area: string) =>
  pathname === area || pathname.startsWith(`${area}/`);

/**
 * Under /learn is Learn, under /present is Present (spec 013); everything else (problems,
 * coding sessions) is Problems.
 */
export function currentArea(pathname: string): string {
  return AREAS.find((a) => a.to !== "/" && under(pathname, a.to))?.to ?? "/";
}

/**
 * The sidebar's area switch (FR-1): Problems, Learn, Present and Games, the current one marked with
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
