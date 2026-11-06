import { afterEach, describe, expect, it, vi } from "vitest";
import { createChessSession, getChessSession, listGames } from "./gamesApi";

function stub(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("gamesApi", () => {
  it("listGames reads /api/games", async () => {
    const fn = stub(200, [{ id: "chess", name: "Chess", description: "d", start_path: "x" }]);
    expect((await listGames())[0]?.id).toBe("chess");
    expect(String((fn.mock.calls[0] as unknown[])[0])).toBe("/api/games");
  });

  it("createChessSession posts and returns the invite", async () => {
    const fn = stub(201, { invite_id: "abc" });
    expect(await createChessSession()).toEqual({ invite_id: "abc" });
    const call = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/games/chess/sessions");
    expect(call[1].method).toBe("POST");
  });

  it("getChessSession returns the pre-join check", async () => {
    stub(200, { invite_id: "abc", stale: false, full: true });
    expect(await getChessSession("abc")).toEqual({ invite_id: "abc", stale: false, full: true });
  });

  it("getChessSession maps 404 to not_found and 410 to session_deleted", async () => {
    stub(404, { error: "not_found" });
    expect(await getChessSession("x")).toEqual({ error: "not_found" });
    stub(410, { error: "session_deleted" });
    expect(await getChessSession("x")).toEqual({ error: "session_deleted" });
  });
});
