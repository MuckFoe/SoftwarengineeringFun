import type { SessionTile as SessionTileData } from "../api/types";
import { CodePreview } from "./CodePreview";
import styles from "./home.module.css";
import { usePreview } from "./usePreview";

const MAX_AVATARS = 4;

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function sessionTileName(t: SessionTileData): string {
  const state = t.live
    ? `Live, ${t.participant_count} ${t.participant_count === 1 ? "person" : "people"}`
    : "idle";
  return `${t.title}, hosted by ${t.host.name}, ${state}`;
}

export function SessionTile({
  tile,
  preview,
  onOpen,
}: {
  tile: SessionTileData;
  /** Code excerpt for coding sessions (when omitted, loaded lazily by the tile). */
  preview?: string | null;
  onOpen: (sessionId: string) => void;
}) {
  const lazy = usePreview(tile.id, tile.has_preview, tile.live, preview === undefined);
  const shown = preview === undefined ? lazy : preview;
  return (
    <button
      type="button"
      data-tile
      className={styles.tile}
      aria-label={sessionTileName(tile)}
      onClick={() => onOpen(tile.id)}
    >
      <span className={styles.tileHead}>
        <span className={styles.kind}>{tile.kind}</span>
        {tile.live && (
          <span className={styles.live}>
            Live <span className={styles.count}>{tile.participant_count}</span>
          </span>
        )}
      </span>
      <span className={styles.title}>{tile.title}</span>
      <span className={styles.meta}>{tile.host.name}</span>
      {tile.kind === "coding" && <CodePreview excerpt={shown} />}
      <span className={styles.tileFoot}>
        {tile.live ? (
          <span className={styles.avatars}>
            {tile.participants.slice(0, MAX_AVATARS).map((p) => (
              <span key={p.id} className={styles.avatar} data-avatar title={p.name}>
                {p.avatar_url ? <img src={p.avatar_url} alt="" /> : p.name.slice(0, 1)}
              </span>
            ))}
          </span>
        ) : (
          tile.last_active_at && (
            <time dateTime={tile.last_active_at}>{ago(tile.last_active_at)}</time>
          )
        )}
      </span>
    </button>
  );
}
