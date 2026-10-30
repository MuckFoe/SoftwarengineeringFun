import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError, listStaleSessions, reactivateSession } from "../api/client";
import type { StaleSession } from "../api/types";
import { Button } from "../ui/Button";
import { Hud } from "../ui/Hud";
import { InlineMessage } from "../ui/InlineMessage";
import { SidebarSection } from "../ui/Sidebar";
import styles from "./StaleSessionsList.module.css";

const LEAVE_MS = 150;

/** "3 hours", "2 days": how long ago, in the largest whole unit. */
function since(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  const [value, unit] =
    minutes < 60
      ? [minutes, "minute"]
      : minutes < 60 * 24
        ? [Math.floor(minutes / 60), "hour"]
        : [Math.floor(minutes / (60 * 24)), "day"];
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

const titleOf = (s: StaleSession): string => s.problem_title ?? s.lesson_title ?? "";

interface Props {
  /** The current time; injectable so "stale for …" is testable. */
  now?: () => number;
  /** Where the list comes from; reactivation goes to the same sessions root. */
  endpoint?: string;
  /** Rows link to `sessionPath + invite_id`. */
  sessionPath?: string;
}

/**
 * The admin "Stale sessions" sidebar section (FR-9): each stale session with how long it
 * has been stale, a link into it, and Reactivate inline. A reactivated session (or one
 * that turned out not to be stale any more, 409) fades out of the list with a HUD.
 */
export function StaleSessionsList({
  now = Date.now,
  endpoint = "/api/sessions/stale",
  sessionPath = "/s/",
}: Props) {
  // "/api/learn/sessions/stale" → "/learn/sessions": the client adds the API prefix itself.
  const sessionsRoot = endpoint.replace(/^\/api/, "").replace(/\/stale$/, "");
  const [sessions, setSessions] = useState<StaleSession[] | null>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState(0);

  useEffect(() => {
    let current = true;
    listStaleSessions(sessionsRoot).then(
      (found) => {
        if (current) setSessions(found);
      },
      () => {
        if (current) setError("Could not load stale sessions.");
      },
    );
    return () => {
      current = false;
    };
  }, [sessionsRoot]);

  async function reactivate(session: StaleSession) {
    setBusy(session.invite_id);
    setError(null);
    try {
      await reactivateSession(session.invite_id, sessionsRoot);
    } catch (err) {
      if (!(err instanceof ApiError && err.error.kind === "conflict")) {
        setError(`Could not reactivate “${titleOf(session)}”.`);
        setBusy(null);
        return;
      }
    }
    setBusy(null);
    setHud((n) => n + 1);
    setLeaving((prev) => new Set(prev).add(session.invite_id));
    setTimeout(() => {
      setSessions((prev) => prev?.filter((s) => s.invite_id !== session.invite_id) ?? null);
    }, LEAVE_MS);
  }

  return (
    <SidebarSection title="Stale sessions">
      {error && <InlineMessage id="stale-sessions-error">{error}</InlineMessage>}
      {sessions?.length === 0 && <p className={styles.empty}>No stale sessions</p>}
      <ul className={styles.list}>
        {sessions?.map((s) => {
          const isLeaving = leaving.has(s.invite_id);
          return (
            <li
              key={s.invite_id}
              className={`${styles.row} ${isLeaving ? "anim-row-out" : "anim-row-in"}`}
              aria-hidden={isLeaving || undefined}
            >
              <Link className={styles.link} to={`${sessionPath}${s.invite_id}`}>
                <span className={styles.title}>{titleOf(s)}</span>
                <span className={styles.age}>stale for {since(s.stale_at, now())}</span>
              </Link>
              <Button
                variant="bordered"
                label={`Reactivate ${titleOf(s)}`}
                busy={busy === s.invite_id}
                disabled={isLeaving}
                onClick={() => void reactivate(s)}
              >
                Reactivate
              </Button>
            </li>
          );
        })}
      </ul>
      {hud > 0 && <Hud key={hud} message="Session reactivated" />}
    </SidebarSection>
  );
}
