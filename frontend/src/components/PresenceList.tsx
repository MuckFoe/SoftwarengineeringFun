import { useEffect, useRef, useState } from "react";
import type { Participant } from "../api/types";
import styles from "./PresenceList.module.css";

interface Props {
  participants: Participant[];
}

const LEAVE_MS = 150;
const PALETTE_SIZE = 6;

/** A stable palette slot per participant id, so a colour never jumps between renders. */
function colourOf(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(--presence-${(hash % PALETTE_SIZE) + 1})`;
}

/**
 * Renders the latest `presence` message (FR-15) as sidebar rows with a colour dot.
 * Joins fade in; a leaver fades out as a decorative ghost row whose name is drawn by CSS
 * only, so the list itself drops them at once.
 */
export function PresenceList({ participants }: Props) {
  const leaving = useLeavers(participants);
  return (
    <ul aria-label="Participants" className={styles.list}>
      {participants.map((p) => (
        <li key={p.id} className={`${styles.row} anim-row-in`}>
          <span data-dot className={styles.dot} style={{ background: colourOf(p.id) }} />
          {p.name}
        </li>
      ))}
      {leaving.map((p) => (
        <li
          key={`leaving-${p.id}`}
          data-leaving
          data-name={p.name}
          aria-hidden="true"
          className={`${styles.row} ${styles.ghost} anim-row-out`}
        >
          <span className={styles.dot} style={{ background: colourOf(p.id) }} />
        </li>
      ))}
    </ul>
  );
}

function useLeavers(participants: Participant[]): Participant[] {
  const previous = useRef(participants);
  const [leaving, setLeaving] = useState<Participant[]>([]);
  useEffect(() => {
    const now = new Set(participants.map((p) => p.id));
    const gone = previous.current.filter((p) => !now.has(p.id));
    previous.current = participants;
    if (gone.length === 0) return;
    setLeaving((current) => [...current, ...gone]);
    // Each departure finishes its own fade, even if presence changes again meanwhile.
    setTimeout(() => setLeaving((current) => current.filter((p) => !gone.includes(p))), LEAVE_MS);
  }, [participants]);
  return leaving;
}
