import type { GameTile as GameTileData } from "../api/types";
import { BoardPreview } from "./BoardPreview";
import styles from "./home.module.css";

export function gameTurnText(t: GameTileData): string {
  if (t.turn === "you") return "your turn";
  if (t.turn === "opponent") return "opponent's turn";
  return "waiting";
}

export function GameTile({
  tile,
  onOpen,
}: {
  tile: GameTileData;
  onOpen: (gameId: string) => void;
}) {
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
