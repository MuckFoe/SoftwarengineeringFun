import { Link, useLocation } from "react-router";
import styles from "./Dock.module.css";
import { Icon, type IconName } from "./Icon";

export interface DockItem {
  key: "sessions" | "problems" | "learn" | "present" | "games";
  label: string;
  to: string;
  icon: IconName;
}

/** The sidebar AreaNav keeps "Problems" for `/`; the dock calls the same route "Sessions". */
export const DOCK_ITEMS: readonly DockItem[] = [
  { key: "sessions", label: "Sessions", to: "/", icon: "chat" },
  { key: "problems", label: "Problems", to: "/problems", icon: "pencil" },
  { key: "learn", label: "Learn", to: "/learn", icon: "doc" },
  { key: "present", label: "Present", to: "/present", icon: "people" },
  { key: "games", label: "Games", to: "/games", icon: "play" },
];

interface Props {
  /** Items the caller says the user may not use, each with the reason shown to assistive tech. */
  disabled?: Partial<Record<DockItem["key"], string>>;
}

const under = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

/** The dock's own current item: Sessions is the home screen, Problems the coding problems and their sessions. */
function currentKey(pathname: string): DockItem["key"] | undefined {
  if (pathname === "/") return "sessions";
  for (const item of DOCK_ITEMS.slice(1)) if (under(pathname, item.to)) return item.key;
  return pathname.startsWith("/s/") ? "problems" : undefined;
}

/**
 * Overlay dock at the bottom with the main areas (spec 016 FR-16): slim with only icons until the
 * pointer or keyboard focus enters it, then it grows to show the labels.
 */
export function Dock({ disabled = {} }: Props) {
  const current = currentKey(useLocation().pathname);
  return (
    <nav className={styles.dock} aria-label="Areas">
      {DOCK_ITEMS.map((item) => {
        const reason = disabled[item.key];
        const inner = (
          <>
            <Icon name={item.icon} />
            <span className={styles.label}>{item.label}</span>
          </>
        );
        if (reason !== undefined) {
          const id = `dock-reason-${item.key}`;
          return (
            // biome-ignore lint/a11y/useAriaPropsSupportedByRole: a disabled area is deliberately not a link; the reason is exposed through aria-describedby
            <span
              key={item.key}
              className={`${styles.item} ${styles.disabled}`}
              aria-disabled="true"
              aria-label={item.label}
              aria-describedby={id}
              title={reason}
            >
              {inner}
              <span id={id} className={styles.reason}>
                {reason}
              </span>
            </span>
          );
        }
        const isCurrent = item.key === current;
        return (
          <Link
            key={item.key}
            to={item.to}
            aria-label={item.label}
            aria-current={isCurrent ? "page" : undefined}
            className={isCurrent ? `${styles.item} ${styles.current}` : styles.item}
          >
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
