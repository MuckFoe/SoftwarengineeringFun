import type { MoveRecord } from "./chessTypes";

/** Numbered SAN pairs (FR-18): `1. e4 e5`. */
export function MoveList({ moves }: { moves: MoveRecord[] }) {
  const lines: string[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    const black = moves[i + 1];
    lines.push(`${i / 2 + 1}. ${moves[i]?.san}${black ? ` ${black.san}` : ""}`);
  }
  return (
    <ol aria-label="Moves" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ol>
  );
}
