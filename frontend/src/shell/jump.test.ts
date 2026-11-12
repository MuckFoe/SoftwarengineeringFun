import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { filterJump, type JumpItem } from "./jump";
import { useJumpIndex } from "./useJumpIndex";

const items: JumpItem[] = [
  { kind: "area", id: "/learn", label: "Learn", to: "/learn" },
  { kind: "session", id: "s1", label: "Graphs LEARN talk", to: "/present/s/s1" },
  { kind: "problem", id: "p1", label: "Two Sum", to: "/" },
  { kind: "problem", id: "p2", label: "Learner's puzzle", to: "/" },
];

describe("filterJump (FR-15)", () => {
  it("lists everything for an empty query", () => {
    expect(filterJump(items, "")).toEqual(items);
    expect(filterJump(items, "   ")).toEqual(items);
  });
  it("matches case-insensitively as a substring", () => {
    expect(filterJump(items, "lEaRn").map((i) => i.id)).toEqual(["/learn", "s1", "p2"]);
    expect(filterJump(items, "sum").map((i) => i.id)).toEqual(["p1"]);
    expect(filterJump(items, "zzz")).toEqual([]);
  });
  it("orders areas, then sessions, then problems, stably, whatever the input order", () => {
    const shuffled = [...items].reverse();
    expect(filterJump(shuffled, "").map((i) => i.kind)).toEqual([
      "area",
      "session",
      "problem",
      "problem",
    ]);
    expect(
      filterJump(shuffled, "")
        .map((i) => i.id)
        .slice(2),
    ).toEqual(["p2", "p1"]);
  });
});

describe("useJumpIndex (FR-15)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("makes no request until opened, then only the existing list requests, once", async () => {
    const sessions = vi.spyOn(client, "getMySessions").mockResolvedValue([
      {
        kind: "chess",
        invite_id: "c1",
        title: "Game",
        last_activity_at: "x",
        stale: false,
        hosted_by_me: true,
        can_delete: true,
      },
    ]);
    const problems = vi
      .spyOn(client, "searchProblems")
      .mockResolvedValue([{ id: "p1", title: "Two Sum", is_starter: true }]);
    const { result, rerender } = renderHook(({ open }) => useJumpIndex(open), {
      initialProps: { open: false },
    });
    expect(sessions).not.toHaveBeenCalled();
    expect(problems).not.toHaveBeenCalled();
    expect(result.current.items.every((i) => i.kind === "area")).toBe(true);
    rerender({ open: true });
    await waitFor(() => expect(result.current.items.map((i) => i.kind)).toContain("problem"));
    rerender({ open: false });
    rerender({ open: true });
    expect(sessions).toHaveBeenCalledTimes(1);
    expect(problems).toHaveBeenCalledTimes(1);
    expect(problems).toHaveBeenCalledWith("");
    const s = result.current.items.find((i) => i.kind === "session");
    expect(s?.to).toBe("/games/chess/s/c1");
  });

  it("still lists areas and problems when the sessions request fails (signed out)", async () => {
    vi.spyOn(client, "getMySessions").mockRejectedValue(new Error("401"));
    vi.spyOn(client, "searchProblems").mockResolvedValue([
      { id: "p1", title: "Two Sum", is_starter: true },
    ]);
    const { result } = renderHook(() => useJumpIndex(true));
    await waitFor(() => expect(result.current.items.map((i) => i.kind)).toContain("problem"));
    expect(result.current.items.some((i) => i.kind === "session")).toBe(false);
  });
});
