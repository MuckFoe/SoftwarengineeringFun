import { afterEach, describe, expect, it } from "vitest";
import { markNoticeSeen, noticeSeen } from "./gifNotice";

afterEach(() => {
  localStorage.clear();
});

function throwingStorage(): Storage {
  const fail = () => {
    throw new Error("storage blocked");
  };
  return {
    length: 0,
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
}

describe("gifNotice", () => {
  // FR-5
  it("is not seen with empty storage", () => {
    expect(noticeSeen("A")).toBe(false);
  });

  // FR-5
  it("is seen for that invite only after marking it", () => {
    markNoticeSeen("A");
    expect(noticeSeen("A")).toBe(true);
    expect(noticeSeen("B")).toBe(false);
  });

  it("stores under gif-notice-seen:<invite>", () => {
    markNoticeSeen("A");
    expect(localStorage.getItem("gif-notice-seen:A")).not.toBeNull();
  });

  it("uses an injected storage instead of localStorage", () => {
    const map = new Map<string, string>();
    const storage = {
      ...throwingStorage(),
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    } as Storage;
    markNoticeSeen("A", storage);
    expect(noticeSeen("A", storage)).toBe(true);
    expect(noticeSeen("A")).toBe(false);
  });

  // FR-5: a blocked storage must never hide the notice
  it("counts a throwing storage as not seen, and marking does not throw", () => {
    const storage = throwingStorage();
    expect(() => markNoticeSeen("A", storage)).not.toThrow();
    expect(noticeSeen("A", storage)).toBe(false);
  });
});
