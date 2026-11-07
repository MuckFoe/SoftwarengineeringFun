import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeSnapshot } from "../api/types";
import { useHomeFeed } from "./useHomeFeed";

const snap = (count: number): HomeSnapshot => ({
  user: { first_name: "Ada", display_name: null, username: "ada" },
  live_participant_count: count,
  sessions: [],
  idle_total: 0,
  games: [],
});

let current: HomeSnapshot;
const fetchMock = vi.fn();

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  current = snap(1);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(current)));
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useHomeFeed", () => {
  it("fetches /api/home on mount and ends loading when it resolves", async () => {
    const { result } = renderHook(() => useHomeFeed());
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.snapshot?.live_participant_count).toBe(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/home");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("picks up a changed response by polling within 5 s, without remount", async () => {
    const { result } = renderHook(() => useHomeFeed());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    current = snap(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.snapshot?.live_participant_count).toBe(3);
  });

  it("does not poll while the document is hidden, and refetches on becoming visible", async () => {
    renderHook(() => useHomeFeed());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => setVisibility("hidden"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => setVisibility("visible"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("debounces refresh() calls: one trailing fetch after 1 s", async () => {
    const { result } = renderHook(() => useHomeFeed());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    current = snap(2);
    act(() => {
      result.current.refresh();
      result.current.refresh();
      result.current.refresh();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.snapshot?.live_participant_count).toBe(2);
  });

  it("reports an error but keeps the last snapshot", async () => {
    const { result } = renderHook(() => useHomeFeed());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fetchMock.mockImplementation(async () => new Response("", { status: 500 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.error).toBeTruthy();
    expect(result.current.snapshot?.live_participant_count).toBe(1);
  });

  it("stops polling after unmount", async () => {
    const { unmount } = renderHook(() => useHomeFeed());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
