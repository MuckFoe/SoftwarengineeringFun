import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createProblem,
  createSession,
  getChat,
  getProblemForEdit,
  getSession,
  previewDescription,
  removeChatMessage,
  searchProblems,
  updateProblem,
  uploadImage,
} from "./client";
import type { ProblemInput } from "./types";

// The backend is not part of this unit; only the HTTP boundary is stubbed so the
// status-to-error mapping can be checked in isolation.
function stubFetch(status: number, body?: unknown) {
  const fn = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("expected the call to reject with ApiError");
}

const input: ProblemInput = {
  title: "Add",
  description: "Add two numbers",
  signature: "def add(a: int, b: int) -> int:",
  tests: [{ args: [1, 2], expected: 3 }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client error mapping", () => {
  it("maps a 422 body to FieldError[]", async () => {
    const errors = [
      { field: "title", message: "required" },
      { field: "tests", test_index: 0, message: "expected must be JSON" },
    ];
    stubFetch(422, { errors });
    const err = await caught(createProblem(input));
    expect(err.status).toBe(422);
    expect(err.error).toEqual({ kind: "validation", errors });
  });

  it("maps a 423 to {stale, canReactivate}", async () => {
    stubFetch(423, { error: "stale", can_reactivate: true });
    const err = await caught(getSession("abc"));
    expect(err.error).toEqual({ kind: "stale", canReactivate: true });

    stubFetch(423, { error: "stale", can_reactivate: false });
    const err2 = await caught(getSession("abc"));
    expect(err2.error).toEqual({ kind: "stale", canReactivate: false });
  });

  it("maps a 403 to missing_role", async () => {
    stubFetch(403, { error: "missing_role", role: "editor" });
    const err = await caught(createProblem(input));
    expect(err.error).toEqual({ kind: "missing_role", role: "editor" });
  });

  it("maps a 401 to unauthorized", async () => {
    stubFetch(401);
    const err = await caught(getProblemForEdit("p1"));
    expect(err.error).toEqual({ kind: "unauthorized" });
  });

  it("maps a 404 to not_found", async () => {
    stubFetch(404, { error: "not_found" });
    const err = await caught(createSession("missing"));
    expect(err.error).toEqual({ kind: "not_found" });
  });
});

describe("api client success paths", () => {
  it("sends JSON and returns the parsed body", async () => {
    const fetchMock = stubFetch(201, { id: "p1" });
    await expect(createProblem(input)).resolves.toEqual({ id: "p1" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/problems");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it("encodes the search query", async () => {
    const fetchMock = stubFetch(200, []);
    await searchProblems("a & b");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/problems?q=a%20%26%20b");
  });
});

// ---- Spec 002: descriptions, images and chat ----

const IMAGE_ID = "0b8e6f4a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

describe("uploadImage", () => {
  it("POSTs the raw file bytes to /api/images and returns id and url", async () => {
    const fetchMock = stubFetch(201, { id: IMAGE_ID, url: `/api/images/${IMAGE_ID}` });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = new File([bytes], "diagram.png", { type: "image/png" });

    await expect(uploadImage(file)).resolves.toEqual({
      id: IMAGE_ID,
      url: `/api/images/${IMAGE_ID}`,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/images");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(file);
    const sent = new Uint8Array(await file.arrayBuffer());
    expect([...sent]).toEqual([...bytes]);
  });

  it("maps a 413 to image_too_large with the byte limit", async () => {
    stubFetch(413, { error: "image_too_large", limit_bytes: 2097152 });
    const err = await caught(uploadImage(new File([new Uint8Array(1)], "big.png")));
    expect(err.status).toBe(413);
    expect(err.error).toEqual({ kind: "image_too_large", limitBytes: 2097152 });
  });

  it("maps a 415 to image_format with the accepted formats", async () => {
    stubFetch(415, { error: "image_format", accepted: ["png", "jpeg", "gif", "webp"] });
    const err = await caught(uploadImage(new File(["%PDF-1.4"], "doc.pdf")));
    expect(err.status).toBe(415);
    expect(err.error).toEqual({
      kind: "image_format",
      accepted: ["png", "jpeg", "gif", "webp"],
    });
  });
});

describe("previewDescription", () => {
  it("POSTs the Markdown source and returns the rendered html", async () => {
    const fetchMock = stubFetch(200, { html: "<h2>Task</h2>" });
    await expect(previewDescription("## Task")).resolves.toEqual({ html: "<h2>Task</h2>" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/problems/preview");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ description: "## Task" });
  });
});

describe("description refusals on save", () => {
  it.each([
    [{ error: "description_required" }, { code: "description_required" }],
    [
      { error: "too_many_images", limit: 10 },
      { code: "too_many_images", limit: 10 },
    ],
    [
      { error: "image_not_found", id: IMAGE_ID },
      { code: "image_not_found", id: IMAGE_ID },
    ],
    [{ error: "image_source_not_allowed" }, { code: "image_source_not_allowed" }],
  ])("maps 422 %j to a description error", async (body, expected) => {
    stubFetch(422, body);
    const err = await caught(updateProblem("p1", input));
    expect(err.error).toEqual({ kind: "description", ...expected });
  });
});

describe("getChat", () => {
  it("GETs the session's chat and returns messages and read_only", async () => {
    const messages = [
      { id: 1, sender_name: "Ana", text: "one", sent_at: "2026-10-25T09:00:00Z" },
      { id: 3, sender_name: "Ben", text: "three", sent_at: "2026-10-25T09:01:00Z" },
    ];
    const fetchMock = stubFetch(200, { messages, read_only: true });
    await expect(getChat("inv/1")).resolves.toEqual({ messages, read_only: true });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/sessions/inv%2F1/chat");
    expect(init?.method).toBe("GET");
  });

  it("maps a 404 to not_found", async () => {
    stubFetch(404, { error: "not_found" });
    const err = await caught(getChat("wrong"));
    expect(err.error).toEqual({ kind: "not_found" });
  });
});

describe("removeChatMessage", () => {
  it("DELETEs the message within the session and resolves on 204", async () => {
    const fetchMock = stubFetch(204);
    await expect(removeChatMessage("inv1", 42)).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/sessions/inv1/chat/42");
    expect(init?.method).toBe("DELETE");
  });

  it("tells a 403 apart from a 404", async () => {
    stubFetch(403, { error: "missing_role", role: "admin" });
    const forbidden = await caught(removeChatMessage("inv1", 42));
    expect(forbidden.status).toBe(403);
    expect(forbidden.error).toEqual({ kind: "missing_role", role: "admin" });

    stubFetch(404, { error: "not_found" });
    const missing = await caught(removeChatMessage("inv1", 42));
    expect(missing.status).toBe(404);
    expect(missing.error).toEqual({ kind: "not_found" });
  });
});

// ---- Spec 005 FR1: everything under the base path ----

// BASE is read from import.meta.env when base.ts loads, so each case stubs the env and
// imports a fresh copy of the client (and with it, of base.ts).
async function loadClient(baseUrl: string) {
  vi.stubEnv("BASE_URL", baseUrl);
  vi.resetModules();
  return import("./client");
}

const location = (protocol: string) => ({ protocol, host: "hub.example" }) as Location;

describe("URLs under the base path (spec 005 FR1)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends requests to /collab/api/... under BASE="/collab/"', async () => {
    const client = await loadClient("/collab/");
    const fetchMock = stubFetch(200, []);
    await client.searchProblems("x");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/collab/api/problems?q=x");
  });

  it("keeps the sign-in next router-relative under the base", async () => {
    const client = await loadClient("/collab/");
    expect(client.loginUrl("/problems")).toBe("/collab/api/auth/login?next=%2Fproblems");
  });

  it("puts the WebSocket under the base, wss on https and ws on http", async () => {
    const client = await loadClient("/collab/");
    expect(client.sessionWsUrl("inv1", "Ada", location("https:"))).toBe(
      "wss://hub.example/collab/api/sessions/inv1/ws?name=Ada",
    );
    expect(client.sessionWsUrl("inv1", "Ada", location("http:"))).toBe(
      "ws://hub.example/collab/api/sessions/inv1/ws?name=Ada",
    );
  });

  it('keeps today\'s URLs under BASE="/"', async () => {
    const client = await loadClient("/");
    const fetchMock = stubFetch(200, []);
    await client.searchProblems("x");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/problems?q=x");
    expect(client.loginUrl("/problems")).toBe("/api/auth/login?next=%2Fproblems");
    expect(client.sessionWsUrl("inv1", "Ada", location("http:"))).toBe(
      "ws://hub.example/api/sessions/inv1/ws?name=Ada",
    );
  });
});
