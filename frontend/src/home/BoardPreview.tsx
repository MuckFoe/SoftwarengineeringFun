import { parseFen } from "../games/chess/fen";
import bB from "../games/chess/pieces/bB.svg";
import bK from "../games/chess/pieces/bK.svg";
import bN from "../games/chess/pieces/bN.svg";
import bP from "../games/chess/pieces/bP.svg";
import bQ from "../games/chess/pieces/bQ.svg";
import bR from "../games/chess/pieces/bR.svg";
import wB from "../games/chess/pieces/wB.svg";
import wK from "../games/chess/pieces/wK.svg";
import wN from "../games/chess/pieces/wN.svg";
import wP from "../games/chess/pieces/wP.svg";
import wQ from "../games/chess/pieces/wQ.svg";
import wR from "../games/chess/pieces/wR.svg";
import styles from "./BoardPreview.module.css";

const ART: Record<string, string> = {
  wK,
  wQ,
  wR,
  wB,
  wN,
  wP,
  bK,
  bQ,
  bR,
  bB,
  bN,
  bP,
};

/** Small static board from a FEN. Decorative: hidden from assistive tech, never focusable. */
export function BoardPreview({ fen }: { fen: string }) {
  return (
    <div className={styles.board} aria-hidden="true">
      {parseFen(fen).map((s, i) => {
        const light = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
        const code = s.piece
          ? `${s.piece.color === "white" ? "w" : "b"}${s.piece.kind}`
          : undefined;
        return (
          <div
            key={s.square}
            className={light ? styles.light : styles.dark}
            data-square={s.square}
            data-piece={code}
          >
            {code && <img className={styles.piece} src={ART[code]} alt="" draggable={false} />}
          </div>
        );
      })}
    </div>
  );
}
