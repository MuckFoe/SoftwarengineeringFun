import { apiPath } from "../base";
import type {
  ChatHistory,
  CreatedProblem,
  CreatedSession,
  DescriptionErrorCode,
  DescriptionPreview,
  EditableProblem,
  FieldError,
  Me,
  Problem,
  ProblemInput,
  ProblemSummary,
  SessionState,
  StaleSession,
  UploadedImage,
} from "./types";

/** Typed form of every error status the plan's HTTP contract names. */
export type ApiErrorDetail =
  | { kind: "unauthorized" }
  | { kind: "missing_role"; role: string }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "validation"; errors: FieldError[] }
  | { kind: "stale"; canReactivate: boolean }
  | { kind: "image_too_large"; limitBytes: number }
  | { kind: "image_format"; accepted: string[] }
  | { kind: "description"; code: DescriptionErrorCode; limit?: number; id?: string }
  | { kind: "http" };

export class ApiError extends Error {
  readonly status: number;
  readonly error: ApiErrorDetail;

  constructor(status: number, error: ApiErrorDetail) {
    super(`API ${status}: ${error.kind}`);
    this.name = "ApiError";
    this.status = status;
    this.error = error;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toDetail(status: number, body: unknown): ApiErrorDetail {
  const b = isRecord(body) ? body : {};
  switch (status) {
    case 401:
      return { kind: "unauthorized" };
    case 403:
      return { kind: "missing_role", role: typeof b.role === "string" ? b.role : "" };
    case 404:
      return { kind: "not_found" };
    case 409:
      return { kind: "conflict" };
    case 413:
      return {
        kind: "image_too_large",
        limitBytes: typeof b.limit_bytes === "number" ? b.limit_bytes : 0,
      };
    case 415:
      return {
        kind: "image_format",
        accepted: Array.isArray(b.accepted) ? (b.accepted as string[]) : [],
      };
    case 422:
      if (typeof b.error === "string") return descriptionDetail(b);
      return {
        kind: "validation",
        errors: Array.isArray(b.errors) ? (b.errors as FieldError[]) : [],
      };
    case 423:
      return { kind: "stale", canReactivate: b.can_reactivate === true };
    default:
      return { kind: "http" };
  }
}

function descriptionDetail(b: Record<string, unknown>): ApiErrorDetail {
  const detail: ApiErrorDetail = { kind: "description", code: b.error as DescriptionErrorCode };
  if (typeof b.limit === "number") detail.limit = b.limit;
  if (typeof b.id === "string") detail.id = b.id;
  return detail;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (body === undefined) return send<T>(method, path, {});
  return send<T>(method, path, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function send<T>(method: string, path: string, extra: RequestInit): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", ...extra };
  const res = await fetch(apiPath(path), init);
  const parsed = await readBody(res);
  if (!res.ok) throw new ApiError(res.status, toDetail(res.status, parsed));
  return parsed as T;
}

const enc = encodeURIComponent;

export const getMe = () => request<Me>("GET", "/me");
export const logout = () => request<void>("POST", "/auth/logout");
/** `next` is router-relative ("/problems"), never prefixed with the base path. */
export const loginUrl = (next: string) => apiPath(`/auth/login?next=${enc(next)}`);

export const searchProblems = (q: string) =>
  request<ProblemSummary[]>("GET", `/problems?q=${enc(q)}`);
export const getProblem = (id: string) => request<Problem>("GET", `/problems/${enc(id)}`);
export const createProblem = (input: ProblemInput) =>
  request<CreatedProblem>("POST", "/problems", input);
export const getProblemForEdit = (id: string) =>
  request<EditableProblem>("GET", `/problems/${enc(id)}/edit`);
export const updateProblem = (id: string, input: ProblemInput) =>
  request<void>("PUT", `/problems/${enc(id)}`, input);
export const deleteProblem = (id: string) => request<void>("DELETE", `/problems/${enc(id)}`);

export const previewDescription = (source: string) =>
  request<DescriptionPreview>("POST", "/problems/preview", { description: source });

/** Sends the file's raw bytes; the server decides the format from them, not from the name. */
export const uploadImage = (file: Blob) =>
  send<UploadedImage>("POST", "/images", {
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });

export const createSession = (problemId: string) =>
  request<CreatedSession>("POST", "/sessions", { problem_id: problemId });
export const getSession = (inviteId: string) =>
  request<SessionState>("GET", `/sessions/${enc(inviteId)}`);
/** `sessions` is the API-relative sessions root, e.g. "/learn/sessions" for learning sessions. */
export const listStaleSessions = (sessions = "/sessions") =>
  request<StaleSession[]>("GET", `${sessions}/stale`);
export const reactivateSession = (inviteId: string, sessions = "/sessions") =>
  request<void>("POST", `${sessions}/${enc(inviteId)}/reactivate`);

export const getChat = (inviteId: string) =>
  request<ChatHistory>("GET", `/sessions/${enc(inviteId)}/chat`);
export const removeChatMessage = (inviteId: string, messageId: number) =>
  request<void>("DELETE", `/sessions/${enc(inviteId)}/chat/${messageId}`);

/** URL for the session WebSocket, relative to the current page's origin. */
export function sessionWsUrl(inviteId: string, name: string, loc: Location = window.location) {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}${apiPath(`/sessions/${enc(inviteId)}/ws`)}?name=${enc(name)}`;
}
