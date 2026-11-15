// The single path of each piece's artwork (task 4), so a board can draw it in an inline
// <svg> and paint fill and edge per side from tokens (plan.md UI notes "Sides").
import flag from "./flag.svg?raw";
import hidden from "./hidden.svg?raw";
import paper from "./paper.svg?raw";
import rock from "./rock.svg?raw";
import scissors from "./scissors.svg?raw";
import trap from "./trap.svg?raw";

export type PieceArt = "rock" | "paper" | "scissors" | "flag" | "trap" | "hidden";

const pathOf = (svg: string) => / d="([^"]+)"/.exec(svg)?.[1] ?? "";

export const PIECE_PATHS: Record<PieceArt, string> = {
  rock: pathOf(rock),
  paper: pathOf(paper),
  scissors: pathOf(scissors),
  flag: pathOf(flag),
  trap: pathOf(trap),
  hidden: pathOf(hidden),
};
