import { describe, expect, it } from "vitest";
import { parseFen } from "./fen";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("parseFen", () => {
  it("maps the start position to the 32 expected pieces", () => {
    const squares = parseFen(START);
    expect(squares).toHaveLength(64);
    expect(squares.filter((s) => s.piece !== null)).toHaveLength(32);
    const at = (name: string) => squares.find((s) => s.square === name)?.piece;
    expect(at("e1")).toEqual({ color: "white", kind: "K" });
    expect(at("d8")).toEqual({ color: "black", kind: "Q" });
    expect(at("a2")).toEqual({ color: "white", kind: "P" });
    expect(at("g8")).toEqual({ color: "black", kind: "N" });
    expect(at("e4")).toBeNull();
  });

  it("maps an empty board to 64 empty squares", () => {
    const squares = parseFen("8/8/8/8/8/8/8/8 w - - 0 1");
    expect(squares).toHaveLength(64);
    expect(squares.every((s) => s.piece === null)).toBe(true);
  });

  it("lists squares from a8 to h1", () => {
    const squares = parseFen(START);
    expect(squares[0]?.square).toBe("a8");
    expect(squares[7]?.square).toBe("h8");
    expect(squares[63]?.square).toBe("h1");
  });
});
