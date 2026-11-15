import { afterEach, describe, expect, it } from "vitest";
import { findRejoinToken } from "./rejoinToken";

afterEach(() => localStorage.clear());

describe("findRejoinToken (spec 017 FR-11, 021 FR-24)", () => {
  it("is null with nothing stored", () => {
    expect(findRejoinToken()).toBeNull();
  });

  it("returns the chess token", () => {
    localStorage.setItem("chess:inv1", "tok-chess");
    expect(findRejoinToken()).toBe("tok-chess");
  });

  it("FR-24: returns the stored token for an rps invite", () => {
    localStorage.setItem("rps-rejoin:inv2", "tok-rps");
    expect(findRejoinToken()).toBe("tok-rps");
  });

  it("skips an empty rps entry", () => {
    localStorage.setItem("rps-rejoin:inv2", "");
    expect(findRejoinToken()).toBeNull();
  });
});
