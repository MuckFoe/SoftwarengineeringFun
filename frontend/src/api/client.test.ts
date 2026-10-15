import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createProblem,
  createSession,
  getProblemForEdit,
  getSession,
  searchProblems,
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
