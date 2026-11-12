import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { RecentSession } from "../api/types";
import type { MeState } from "../auth/useMe";
import { anyLive, useAnyLive } from "./useAnyLive";

const meState = vi.hoisted(() => ({
  value: { status: "ready", me: { signed_in: true } } as unknown,
}));
vi.mock("../auth/useMe", () => ({ useMe: () => meState.value as MeState }));

const row = (invite_id: string, live?: boolean): RecentSession => ({
  kind: "coding",
  invite_id,
  title: "t",
  last_activity_at: "2026-11-07T00:00:00Z",
  stale: false,
  hosted_by_me: false,
  can_delete: false,
  ...(live === undefined ? {} : { live }),
});

afterEach(() => {
  vi.restoreAllMocks();
  meState.value = { status: "ready", me: { signed_in: true } };
});

describe("useAnyLive (spec 016 FR-2, FR-5)", () => {
  it("anyLive is false for an all-idle list and true when one row is live", () => {
    expect(anyLive([row("a", false), row("b")])).toBe(false);
    expect(anyLive([])).toBe(false);
    expect(anyLive([row("a", false), row("b", true)])).toBe(true);
  });

  it("the hook follows the fetched list", async () => {
    vi.spyOn(client, "getMySessions").mockResolvedValue([row("a", false), row("b", true)]);
    const { result } = renderHook(() => useAnyLive());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("a failed request (signed out) is not live", async () => {
    const spy = vi.spyOn(client, "getMySessions").mockRejectedValue(new Error("401"));
    const { result } = renderHook(() => useAnyLive());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("a non-array response is not live and does not throw", async () => {
    const spy = vi
      .spyOn(client, "getMySessions")
      .mockResolvedValue({} as unknown as RecentSession[]);
    const { result } = renderHook(() => useAnyLive());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("does not request the session list for an anonymous visitor or while /api/me loads", async () => {
    const spy = vi.spyOn(client, "getMySessions").mockResolvedValue([row("a", true)]);
    meState.value = { status: "ready", me: { signed_in: false } };
    const anon = renderHook(() => useAnyLive());
    meState.value = { status: "loading" };
    const loading = renderHook(() => useAnyLive());
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).not.toHaveBeenCalled();
    expect(anon.result.current).toBe(false);
    expect(loading.result.current).toBe(false);
  });
});
