import { useEffect, useState } from "react";
import { Link } from "react-router";
import { getMySessions, hideMySession } from "../api/client";
import type { RecentSession } from "../api/types";
import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";
import styles from "./ProfileSessions.module.css";

const KIND_LABEL: Record<RecentSession["kind"], string> = {
  coding: "Coding",
  learning: "Learning",
  presentation: "Presentation",
  chess: "Chess",
};

const KIND_ROUTE: Record<RecentSession["kind"], string> = {
  coding: "/s/",
  learning: "/learn/s/",
  presentation: "/present/s/",
  chess: "/games/chess/s/",
};

/** "just now", "5 minutes ago", "1 day ago": how long ago, in the largest whole unit. */
function relative(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  const [value, unit] =
    minutes < 60
      ? [minutes, "minute"]
      : minutes < 60 * 24
        ? [Math.floor(minutes / 60), "hour"]
        : [Math.floor(minutes / (60 * 24)), "day"];
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

const keyOf = (s: RecentSession) => `${s.kind}:${s.invite_id}`;

interface Props {
  /** The current time; injectable so the relative last activity is testable. */
  now?: () => number;
}

/**
 * The profile's recent sessions (spec 012 FR-2, FR-4, FR-12, FR-13), in the server's order:
 * kind, title linking to the kind's normal route (a stale session's window handles the stale
 * path), relative last activity, Stale and Hosted by you badges, and Hide. Mounted by
 * ProfileWindow for a signed-in user only (FR-10).
 */
export function ProfileSessions({ now = Date.now }: Props) {
  const [sessions, setSessions] = useState<RecentSession[] | null>(null);
  const [hiding, setHiding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    getMySessions().then(
      (found) => {
        if (current) setSessions(found);
      },
      () => {
        if (current) setError("Could not load your sessions.");
      },
    );
    return () => {
      current = false;
    };
  }, []);

  async function hide(session: RecentSession) {
    const key = keyOf(session);
    setHiding(key);
    setError(null);
    try {
      await hideMySession(session.kind, session.invite_id);
      setSessions((prev) => prev?.filter((s) => keyOf(s) !== key) ?? null);
    } catch {
      setError(`Could not hide “${session.title}”.`);
    } finally {
      setHiding(null);
    }
  }

  const at = now();

  return (
    <section className={styles.section} aria-labelledby="profile-sessions">
      <h2 id="profile-sessions" className={styles.heading}>
        Sessions
      </h2>
      {error && <InlineMessage id="profile-sessions-error">{error}</InlineMessage>}
      {sessions?.length === 0 && <p className={styles.empty}>No recent sessions</p>}
      {sessions && sessions.length > 0 && (
        <table className={styles.table} aria-labelledby="profile-sessions">
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">Title</th>
              <th scope="col">Last activity</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className={styles.visuallyHidden}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={keyOf(s)} className="anim-row-in">
                <td className={styles.secondary}>{KIND_LABEL[s.kind]}</td>
                <td className={styles.titleCell}>
                  <Link className={styles.link} to={`${KIND_ROUTE[s.kind]}${s.invite_id}`}>
                    {s.title}
                  </Link>
                </td>
                <td className={styles.secondary}>
                  <time dateTime={s.last_activity_at} title={s.last_activity_at}>
                    {relative(s.last_activity_at, at)}
                  </time>
                </td>
                <td className={styles.badges}>
                  {s.stale && <span className={`${styles.badge} ${styles.stale}`}>Stale</span>}
                  {s.hosted_by_me && <span className={styles.badge}>Hosted by you</span>}
                </td>
                <td className={styles.actions}>
                  <Button
                    variant="bordered"
                    label={`Hide ${s.title}`}
                    busy={hiding === keyOf(s)}
                    onClick={() => void hide(s)}
                  >
                    Hide
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
