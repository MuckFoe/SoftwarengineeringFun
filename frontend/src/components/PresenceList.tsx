import type { Participant } from "../api/types";

interface Props {
  participants: Participant[];
}

/** Renders the latest `presence` message (FR-15). */
export function PresenceList({ participants }: Props) {
  return (
    <ul aria-label="Participants">
      {participants.map((p) => (
        <li key={p.id}>{p.name}</li>
      ))}
    </ul>
  );
}
