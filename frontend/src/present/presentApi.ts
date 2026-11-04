// REST client for spec 013 (plan.md "Contracts — REST"). Uploads go as raw bodies; every
// non-2xx answer resolves to `{error, ...}` instead of throwing, so callers branch on it.
import { apiPath } from "../base";
import type {
  Analysis,
  ChatHistory,
  PresentationSummary,
  PresentError,
  PresentErrorCode,
  PresentSessionState,
  StartedSession,
} from "./presentTypes";

export type PresentResult<T> = T | PresentError;

export function isPresentError(v: unknown): v is PresentError {
  return (
    typeof v === "object" && v !== null && typeof (v as { error?: unknown }).error === "string"
  );
}

const STATUS_CODES: Record<number, PresentErrorCode> = {
  401: "unauthorized",
  403: "missing_role",
  404: "not_found",
};

function toError(status: number, body: unknown): PresentError {
  const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const err: PresentError = {
    error:
      typeof b.error === "string"
        ? (b.error as PresentErrorCode)
        : (STATUS_CODES[status] ?? "http"),
  };
  if (typeof b.limit_bytes === "number") err.limit_bytes = b.limit_bytes;
  if (typeof b.role === "string") err.role = b.role;
  return err;
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

async function send<T>(
  method: string,
  path: string,
  extra: RequestInit = {},
): Promise<PresentResult<T>> {
  const res = await fetch(apiPath(path), { method, credentials: "same-origin", ...extra });
  const body = await readBody(res);
  if (!res.ok) return toError(res.status, body);
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** A file's bytes or pasted markup, untouched; the server decides what it is. */
const raw = (body: Blob | string): RequestInit => ({
  headers: {
    "Content-Type":
      typeof body === "string" ? "text/html; charset=utf-8" : body.type || "text/html",
  },
  body,
});

const enc = encodeURIComponent;
const sessionPath = (invite: string) => `/present/sessions/${enc(invite)}`;

export const listPresentations = () => send<PresentationSummary[]>("GET", "/present/presentations");

export const analyze = (body: Blob | string) =>
  send<Analysis>("POST", "/present/analyze", raw(body));

export const addPresentation = (title: string, topic: string, body: Blob | string) =>
  send<PresentationSummary>(
    "POST",
    `/present/presentations?title=${enc(title)}&topic=${enc(topic)}`,
    raw(body),
  );

export const replaceHtml = (id: string, body: Blob | string) =>
  send<PresentationSummary>("PUT", `/present/presentations/${enc(id)}/html`, raw(body));

export const removePresentation = (id: string) =>
  send<void>("DELETE", `/present/presentations/${enc(id)}`);

export const startSession = (presentationId: string) =>
  send<StartedSession>("POST", "/present/sessions", json({ presentation_id: presentationId }));

export const getSession = (invite: string) => send<PresentSessionState>("GET", sessionPath(invite));

export const getChat = (invite: string) => send<ChatHistory>("GET", `${sessionPath(invite)}/chat`);

export const removeChatMessage = (invite: string, messageId: number) =>
  send<void>("DELETE", `${sessionPath(invite)}/chat/${messageId}`);

export const reactivate = (invite: string) =>
  send<Record<string, never>>("POST", `${sessionPath(invite)}/reactivate`);

/** The frame document's URL; bridge.js reads the starting slide from `#slide=i`. */
export const frameUrl = (invite: string, slide: number | null) =>
  `${apiPath(`${sessionPath(invite)}/frame`)}${slide === null ? "" : `#slide=${slide}`}`;
