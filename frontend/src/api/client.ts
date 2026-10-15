import type {
  CreatedProblem,
  CreatedSession,
  EditableProblem,
  FieldError,
  Me,
  Problem,
  ProblemInput,
  ProblemSummary,
  SessionState,
} from "./types";

/** Typed form of every error status the plan's HTTP contract names. */
export type ApiErrorDetail =
  | { kind: "unauthorized" }
  | { kind: "missing_role"; role: string }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "validation"; errors: FieldError[] }
  | { kind: "stale"; canReactivate: boolean }
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
    case 422:
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
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, init);
  const parsed = await readBody(res);
  if (!res.ok) throw new ApiError(res.status, toDetail(res.status, parsed));
  return parsed as T;
}

const enc = encodeURIComponent;

export const getMe = () => request<Me>("GET", "/me");
export const logout = () => request<void>("POST", "/auth/logout");
export const loginUrl = (next: string) => `/api/auth/login?next=${enc(next)}`;

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

export const createSession = (problemId: string) =>
  request<CreatedSession>("POST", "/sessions", { problem_id: problemId });
export const getSession = (inviteId: string) =>
  request<SessionState>("GET", `/sessions/${enc(inviteId)}`);
export const reactivateSession = (inviteId: string) =>
  request<void>("POST", `/sessions/${enc(inviteId)}/reactivate`);

/** URL for the session WebSocket, relative to the current page's origin. */
export function sessionWsUrl(inviteId: string, name: string, loc: Location = window.location) {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/api/sessions/${enc(inviteId)}/ws?name=${enc(name)}`;
}
