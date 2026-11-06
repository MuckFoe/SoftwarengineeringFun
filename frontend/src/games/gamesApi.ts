// REST client for spec 014's games endpoints (plan.md "Contracts — REST"). Every call here
// is open to visitors; the pre-join check maps 404 and 410 to a result instead of throwing.
import { ApiError } from "../api/client";
import { apiPath } from "../base";

export interface GameInfo {
  id: string;
  name: string;
  description: string;
  start_path: string;
}

export interface ChessSessionCheck {
  invite_id: string;
  stale: boolean;
  full: boolean;
}

export type ChessSessionLookup = ChessSessionCheck | { error: "not_found" | "session_deleted" };

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function send(method: string, path: string): Promise<Response> {
  return fetch(apiPath(path), { method, credentials: "same-origin" });
}

async function ok<T>(res: Response): Promise<T> {
  const body = await readBody(res);
  if (!res.ok) throw new ApiError(res.status, { kind: res.status === 404 ? "not_found" : "http" });
  return body as T;
}

export const listGames = async () => ok<GameInfo[]>(await send("GET", "/games"));

export const createChessSession = async () =>
  ok<{ invite_id: string }>(await send("POST", "/games/chess/sessions"));

export async function getChessSession(invite: string): Promise<ChessSessionLookup> {
  const res = await send("GET", `/games/chess/sessions/${encodeURIComponent(invite)}`);
  if (res.status === 404) return { error: "not_found" };
  if (res.status === 410) return { error: "session_deleted" };
  return ok<ChessSessionCheck>(res);
}
