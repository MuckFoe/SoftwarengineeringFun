import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTile as Tile } from "../api/types";
import { SessionTile } from "./SessionTile";

const tile = (over: Partial<Tile> = {}): Tile => ({
  id: "s1",
  invite_id: "i1",
  kind: "coding",
  title: "Two sum",
  host: { id: "h", name: "Ada" },
  live: true,
  participant_count: 1,
  participants: [],
  last_active_at: null,
  has_preview: true,
  ...over,
});

let resolvers: Array<(r: Response) => void> = [];
const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  resolvers = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => new Promise<Response>((res) => resolvers.push(res)));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (b: unknown) =>
  new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } });
const flush = () => act(async () => {});

describe("lazy preview", () => {
  it("renders the tile while the preview is pending, then fills it in", async () => {
    const { container } = render(<SessionTile tile={tile()} onOpen={() => {}} />);
    expect(screen.getByRole("button")).toBeTruthy();
    expect(container.querySelector("pre")).toBeNull();
    await act(async () =>
      resolvers[0]?.(json({ session_id: "s1", language: "python", excerpt: "x = 1" })),
    );
    expect(container.querySelector("pre")?.textContent).toContain("x = 1");
  });

  it("204 and 404 give no preview element", async () => {
    const a = render(<SessionTile tile={tile()} onOpen={() => {}} />);
    await act(async () => resolvers[0]?.(new Response(null, { status: 204 })));
    expect(a.container.querySelector("pre")).toBeNull();
    a.unmount();
    const b = render(<SessionTile tile={tile({ id: "s2" })} onOpen={() => {}} />);
    await act(async () =>
      resolvers[1]?.(
        new Response(JSON.stringify({ detail: "no" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    expect(b.container.querySelector("pre")).toBeNull();
  });

  it("does not fetch without has_preview, fetches when it flips true", async () => {
    const { rerender } = render(
      <SessionTile tile={tile({ has_preview: false })} onOpen={() => {}} />,
    );
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(<SessionTile tile={tile({ has_preview: true })} onOpen={() => {}} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes every 15 s while live, not when idle", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    const live = render(<SessionTile tile={tile()} onOpen={() => {}} />);
    await flush();
    await act(async () => void vi.advanceTimersByTime(15000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    live.unmount();
    fetchMock.mockClear();
    render(<SessionTile tile={tile({ live: false })} onOpen={() => {}} />);
    await flush();
    await act(async () => void vi.advanceTimersByTime(45000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
