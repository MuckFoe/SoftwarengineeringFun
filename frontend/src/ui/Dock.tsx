import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
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

/** Where the sliding "you are here" pill sits: the current item's box inside the dock. */
interface Spot {
  x: number;
  width: number;
}

const MIDDLE = (DOCK_ITEMS.length - 1) / 2;

/**
 * Overlay dock at the bottom with the main areas (spec 016 FR-16). At rest it is a small glowing
 * nub; pointing at it (or keyboard focus inside) grows the nub into the full pill while the items
 * ripple in from the middle. A pill slides under the current area when the route changes.
 */
export function Dock({ disabled = {} }: Props) {
  const current = currentKey(useLocation().pathname);
  const nav = useRef<HTMLElement>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  // The first placement doesn't slide in from nowhere; later route changes glide.
  const [placed, setPlaced] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the route's current area changes
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const measure = () => {
      const item = el.querySelector<HTMLElement>('[aria-current="page"]');
      setSpot(item ? { x: item.offsetLeft, width: item.offsetWidth } : null);
    };
    measure();
    const frame = requestAnimationFrame(() => setPlaced(true));
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [current]);

  const indicator: CSSProperties | undefined = spot
    ? ({ "--spot-x": `${spot.x}px`, "--spot-w": `${spot.width}px` } as CSSProperties)
    : undefined;

  return (
    // The zone is the dock's whole box down to the screen edge: pointing anywhere in it opens
    // the dock, so the nub needn't be hit exactly.
    <div className={styles.zone}>
      <nav ref={nav} className={styles.dock} aria-label="Areas">
        <span
          className={styles.indicator}
          style={indicator}
          data-shown={spot ? "" : undefined}
          data-placed={placed ? "" : undefined}
          aria-hidden="true"
        />
        {DOCK_ITEMS.map((item, index) => {
          const ripple = { "--ripple": Math.abs(index - MIDDLE) } as CSSProperties;
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
                style={ripple}
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
              style={ripple}
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
    </div>
  );
}
