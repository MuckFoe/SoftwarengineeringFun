import type { HomeSnapshot } from "../api/types";
import { Icon } from "../ui/Icon";
import { GameTile } from "./GameTile";
import { displayName, greetingFor } from "./greeting";
import styles from "./home.module.css";
import { SessionTile } from "./SessionTile";

export const SHOW_MORE_THRESHOLD = 8;

interface Props {
  snapshot: HomeSnapshot;
  /** Clock for the greeting (tests fix it). */
  now?: Date;
  onStart: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenGame: (gameId: string) => void;
  /** Opens the existing full sessions list. */
  onShowMore: () => void;
}

export function HomeScreen({
  snapshot,
  now = new Date(),
  onStart,
  onOpenSession,
  onOpenGame,
  onShowMore,
}: Props) {
  const { salutation, summary } = greetingFor(
    now,
    displayName(snapshot.user),
    snapshot.live_participant_count,
  );
  const empty = snapshot.sessions.length === 0 && snapshot.games.length === 0;
  return (
    <section className={styles.home}>
      <header className={styles.greeting}>
        <h1 className={styles.salutation}>{salutation}</h1>
        <p className={styles.summary} aria-live="polite">
          {summary}
        </p>
      </header>
      {empty && <p className={styles.emptyText}>Nothing here yet. Start a session to get going.</p>}
      <ul className={styles.grid}>
        <li className={styles.cell}>
          <button
            type="button"
            data-tile
            className={`${styles.tile} ${styles.start}`}
            onClick={onStart}
          >
            <Icon name="plus" size={24} />
            <span className={styles.title}>Start session</span>
          </button>
        </li>
        {snapshot.sessions.map((s) => (
          <li key={s.id} className={styles.cell}>
            <SessionTile tile={s} onOpen={onOpenSession} />
          </li>
        ))}
        {snapshot.games.map((g) => (
          <li key={g.id} className={styles.cell}>
            <GameTile tile={g} onOpen={onOpenGame} />
          </li>
        ))}
        {snapshot.idle_total > SHOW_MORE_THRESHOLD && (
          <li className={styles.cell}>
            <button type="button" data-tile className={styles.tile} onClick={onShowMore}>
              <span className={styles.title}>Show more</span>
              <span className={styles.meta}>All {snapshot.idle_total} earlier sessions</span>
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}
