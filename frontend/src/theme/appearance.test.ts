import { afterEach, describe, expect, it, vi } from "vitest";
import { loadChoice, resolve, saveChoice } from "./appearance";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("resolve", () => {
  // AC-6
  it("follows the OS when the choice is system", () => {
    expect(resolve("system", true)).toBe("dark");
    expect(resolve("system", false)).toBe("light");
  });

  it("ignores the OS for an explicit choice", () => {
    expect(resolve("light", true)).toBe("light");
    expect(resolve("dark", false)).toBe("dark");
  });
});

describe("loadChoice", () => {
  // AC-6
  it("is system with nothing stored", () => {
    expect(loadChoice()).toBe("system");
  });

  it("is system for an invalid stored value", () => {
    localStorage.setItem("appearance", "purple");
    expect(loadChoice()).toBe("system");
  });

  it("is system when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(loadChoice()).toBe("system");
  });
});

describe("saveChoice", () => {
  // AC-7
  it("keeps Light under a dark OS, and System follows the OS again", () => {
    saveChoice("light");
    expect(localStorage.getItem("appearance")).toBe("light");
    expect(loadChoice()).toBe("light");
    expect(resolve(loadChoice(), true)).toBe("light");

    saveChoice("system");
    expect(resolve(loadChoice(), true)).toBe("dark");
  });

  it("never throws when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveChoice("dark")).not.toThrow();
  });
});
