import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecentSession } from "../api/types";
import { filterJump } from "./jump";
import { useJumpIndex } from "./useJumpIndex";

const RPS: RecentSession = {
  kind: "rps",
  invite_id: "r1invite",
  title: "Rock Paper Siege",
  last_activity_at: "2026-11-04T12:00:00Z",
  stale: false,
  hosted_by_me: true,
  can_delete: true,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useJumpIndex", () => {
  it("021 AC-25 (FR-26): an rps session is listed by its name and opens its rps route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        const body = url.pathname === "/api/me/sessions" ? [RPS] : [];
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const { result } = renderHook(() => useJumpIndex(true));
    await waitFor(() =>
      expect(filterJump(result.current.items, "rock paper siege")).toHaveLength(1),
    );
    expect(filterJump(result.current.items, "rock paper siege")[0]).toMatchObject({
      kind: "session",
      label: "Rock Paper Siege",
      to: "/games/rps/s/r1invite",
    });
  });
});
