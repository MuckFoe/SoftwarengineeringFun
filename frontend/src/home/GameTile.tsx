import type { ChessGameTile, GameTile as GameTileData, RpsGameTile } from "../api/types";
import { BoardPreview } from "./BoardPreview";
import styles from "./home.module.css";
import { RpsBoardPreview } from "./RpsBoardPreview";

const MAX_AVATARS = 4;

export function gameTurnText(t: GameTileData): string {
  if (t.turn === "you") return "your turn";
  if (t.turn === "opponent") return "opponent's turn";
  if (t.game === "rps" && t.status === "setup") return "setting up";
  return "waiting";
}

/** Accessible name of an rps tile: name, starter and live state (FR-25, UI C.16). */
export function rpsTileName(t: RpsGameTile): string {
  const state = t.live
    ? `Live, ${t.participant_count} ${t.participant_count === 1 ? "person" : "people"}`
    : `idle, ${gameTurnText(t)}`;
  return `${t.title}, started by ${t.starter.name}, ${state}`;
}

export function GameTile({
  tile,
  onOpen,
}: {
  tile: GameTileData;
  onOpen: (gameId: string) => void;
}) {
  return tile.game === "rps" ? (
    <RpsTile tile={tile} onOpen={onOpen} />
  ) : (
    <ChessTile tile={tile} onOpen={onOpen} />
  );
}

function ChessTile({ tile, onOpen }: { tile: ChessGameTile; onOpen: (gameId: string) => void }) {
  const turn = gameTurnText(tile);
  const against = tile.opponent ? `against ${tile.opponent.name}` : "waiting for an opponent";
  return (
    <button
      type="button"
      data-tile
      className={styles.tile}
      aria-label={
        tile.opponent ? `${tile.title}, ${against}, ${turn}` : `${tile.title}, ${against}`
      }
      onClick={() => onOpen(tile.id)}
    >
      <span className={styles.tileHead}>
        <span className={styles.kind}>game</span>
      </span>
      <span className={styles.title}>{tile.title}</span>
      <span className={styles.meta}>
        {tile.opponent ? `vs ${tile.opponent.name}` : "Waiting for an opponent"}
      </span>
      <BoardPreview fen={tile.fen} />
      <span className={styles.tileFoot}>
        <span className={tile.turn === "you" ? styles.yourTurn : styles.meta}>{turn}</span>
      </span>
    </button>
  );
}

function RpsTile({ tile, onOpen }: { tile: RpsGameTile; onOpen: (gameId: string) => void }) {
  const turn = gameTurnText(tile);
  return (
    <button
      type="button"
      data-tile
      className={styles.tile}
      aria-label={rpsTileName(tile)}
      onClick={() => onOpen(tile.id)}
    >
      <span className={styles.tileHead}>
        <span className={styles.kind}>game</span>
        {tile.live && (
          <span className={styles.live}>
            Live <span className={styles.count}>{tile.participant_count}</span>
          </span>
        )}
      </span>
      <span className={styles.title}>{tile.title}</span>
      <span className={styles.meta}>{tile.starter.name}</span>
      <RpsBoardPreview board={tile.board} />
      <span className={styles.tileFoot}>
        {tile.live && (
          <span className={styles.avatars}>
            {tile.participants.slice(0, MAX_AVATARS).map((p) => (
              <span key={p.id} className={styles.avatar} data-avatar title={p.name}>
                {p.avatar_url ? <img src={p.avatar_url} alt="" /> : p.name.slice(0, 1)}
              </span>
            ))}
          </span>
        )}
        <span className={tile.turn === "you" ? styles.yourTurn : styles.meta}>{turn}</span>
      </span>
    </button>
  );
}
