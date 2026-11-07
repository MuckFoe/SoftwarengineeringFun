import { describe, expect, it } from "vitest";
import { displayName, greetingFor } from "./greeting";

const at = (h: number) => new Date(2026, 0, 5, h, 0, 0);

describe("greetingFor", () => {
  it("FR-1: 19:00, two live, names the user", () => {
    const g = greetingFor(at(19), "Ada", 2);
    expect(g.salutation).toBe("Good evening, Ada");
    expect(g.summary).toBe("2 people are coding right now");
  });
  it("uses singular for one", () => {
    expect(greetingFor(at(9), "Ada", 1).summary).toBe("1 person is coding right now");
  });
  it("FR-1: nobody live never says 0 people", () => {
    for (const n of [0, null]) {
      const s = greetingFor(at(9), "Ada", n).summary;
      expect(s).toBe("Nobody is live right now");
      expect(s).not.toMatch(/0 people/);
    }
  });
  it("time bands", () => {
    expect(greetingFor(at(5), "A", 0).salutation).toMatch(/morning/);
    expect(greetingFor(at(11), "A", 0).salutation).toMatch(/morning/);
    expect(greetingFor(at(12), "A", 0).salutation).toMatch(/afternoon/);
    expect(greetingFor(at(17), "A", 0).salutation).toMatch(/afternoon/);
    expect(greetingFor(at(18), "A", 0).salutation).toMatch(/evening/);
    expect(greetingFor(at(2), "A", 0).salutation).toMatch(/evening/);
  });
});

describe("displayName", () => {
  it("falls back first name, display name, username", () => {
    expect(displayName({ first_name: "Ada", display_name: "AL", username: "ada1" })).toBe("Ada");
    expect(displayName({ first_name: null, display_name: "AL", username: "ada1" })).toBe("AL");
    expect(displayName({ first_name: "", display_name: null, username: "ada1" })).toBe("ada1");
  });
});
