import { afterEach, describe, expect, it, vi } from "vitest";
import { apiPath } from "../base";
import {
  addPresentation,
  analyze,
  frameUrl,
  getChat,
  getSession,
  isPresentError,
  listPresentations,
  reactivate,
  removeChatMessage,
  removePresentation,
  replaceHtml,
  startSession,
} from "./presentApi";

// Only the HTTP boundary is stubbed: the unit is the request shape and the status mapping.
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

function call(fn: ReturnType<typeof stubFetch>, i = 0) {
  const c = fn.mock.calls[i];
  if (!c) throw new Error(`fetch call ${i} was not made`);
  const [input, init] = c;
  return { url: String(input), init: init ?? {} };
}

const summary = {
  id: "p1",
  title: "Intro to DNS",
  topic: "Networking",
  kind: "slides",
  slide_count: 3,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("presentApi requests", () => {
  it("AC-1: add sends the raw bytes with title and topic query params", async () => {
    const fn = stubFetch(201, summary);
    const file = new Blob(["<h1>DNS</h1>"], { type: "text/html" });
    const res = await addPresentation("Intro to DNS", "Networking & more", file);
    expect(res).toEqual(summary);
    const { url, init } = call(fn);
    expect(url).toBe(
      apiPath("/present/presentations?title=Intro%20to%20DNS&topic=Networking%20%26%20more"),
    );
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe(file);
  });

  it("AC-1: pasted markup is sent as the raw text body", async () => {
    const fn = stubFetch(201, summary);
    await addPresentation("T", "Topic", "<p>pasted</p>");
    const { init } = call(fn);
    expect(init.body).toBe("<p>pasted</p>");
    expect(new Headers(init.headers).get("Content-Type")).toMatch(/^text\/html/);
  });

  it("analyze posts the raw body and returns kind and slide count", async () => {
    const fn = stubFetch(200, { kind: "page", slide_count: 0 });
    expect(await analyze("<p>x</p>")).toEqual({ kind: "page", slide_count: 0 });
    const { url, init } = call(fn);
    expect(url).toBe(apiPath("/present/analyze"));
    expect(init.method).toBe("POST");
    expect(init.body).toBe("<p>x</p>");
  });

  it("replaceHtml PUTs the raw body to the presentation's html", async () => {
    const fn = stubFetch(200, summary);
    await replaceHtml("a/b", "<p>v2</p>");
    const { url, init } = call(fn);
    expect(url).toBe(apiPath("/present/presentations/a%2Fb/html"));
    expect(init.method).toBe("PUT");
    expect(init.body).toBe("<p>v2</p>");
  });

  it("lists presentations and removes one", async () => {
    let fn = stubFetch(200, [summary]);
    expect(await listPresentations()).toEqual([summary]);
    expect(call(fn).url).toBe(apiPath("/present/presentations"));
    expect(call(fn).init.credentials).toBe("same-origin");

    fn = stubFetch(204);
    expect(isPresentError(await removePresentation("p1"))).toBe(false);
    expect(call(fn).url).toBe(apiPath("/present/presentations/p1"));
    expect(call(fn).init.method).toBe("DELETE");
  });

  it("AC-8: startSession posts the presentation id and returns the invite", async () => {
    const fn = stubFetch(201, { invite_id: "inv123" });
    expect(await startSession("p1")).toEqual({ invite_id: "inv123" });
    const { url, init } = call(fn);
    expect(url).toBe(apiPath("/present/sessions"));
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ presentation_id: "p1" });
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("session state, chat, chat removal and reactivate hit the invite's paths", async () => {
    const state = {
      title: "T",
      topic: "X",
      kind: "slides",
      slide_count: 2,
      available: true,
      stale: false,
      can_reactivate: false,
      host_name: "Ana",
      place: { slide: 0, anchor: null },
    };
    let fn = stubFetch(200, state);
    expect(await getSession("inv")).toEqual(state);
    expect(call(fn).url).toBe(apiPath("/present/sessions/inv"));

    fn = stubFetch(200, { messages: [], read_only: false });
    expect(await getChat("inv")).toEqual({ messages: [], read_only: false });
    expect(call(fn).url).toBe(apiPath("/present/sessions/inv/chat"));

    fn = stubFetch(204);
    await removeChatMessage("inv", 7);
    expect(call(fn).url).toBe(apiPath("/present/sessions/inv/chat/7"));
    expect(call(fn).init.method).toBe("DELETE");

    fn = stubFetch(200, {});
    expect(isPresentError(await reactivate("inv"))).toBe(false);
    expect(call(fn).url).toBe(apiPath("/present/sessions/inv/reactivate"));
    expect(call(fn).init.method).toBe("POST");
  });

  it("frameUrl points at the frame route with the slide in the fragment", () => {
    expect(frameUrl("inv", 2)).toBe(`${apiPath("/present/sessions/inv/frame")}#slide=2`);
    expect(frameUrl("inv", null)).toBe(apiPath("/present/sessions/inv/frame"));
  });
});

describe("presentApi errors resolve, never throw", () => {
  it("AC-3: a 413 resolves to too_large with the limit", async () => {
    stubFetch(413, { error: "too_large", limit_bytes: 5242880 });
    expect(await addPresentation("T", "X", "<p>big</p>")).toEqual({
      error: "too_large",
      limit_bytes: 5242880,
    });
  });

  it("AC-3: a 422 resolves to not_html", async () => {
    stubFetch(422, { error: "not_html" });
    const res = await analyze(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]));
    expect(res).toEqual({ error: "not_html" });
    expect(isPresentError(res)).toBe(true);
  });

  it("AC-7: a 403 resolves to missing_role", async () => {
    stubFetch(403, { error: "missing_role", role: "editor" });
    const res = await replaceHtml("p1", "<p>x</p>");
    expect(isPresentError(res)).toBe(true);
    expect(res).toMatchObject({ error: "missing_role" });
  });

  it("a 403 without a body still resolves to missing_role; 401 and 404 get codes", async () => {
    stubFetch(403);
    expect(await removePresentation("p1")).toEqual({ error: "missing_role" });
    stubFetch(401);
    expect(await addPresentation("T", "X", "<p/>")).toEqual({ error: "unauthorized" });
    stubFetch(404);
    expect(await getSession("nope")).toEqual({ error: "not_found" });
  });

  it("other error bodies pass their code through", async () => {
    stubFetch(409, { error: "not_stale" });
    expect(await reactivate("inv")).toEqual({ error: "not_stale" });
    stubFetch(422, { error: "invalid_title" });
    expect(await addPresentation("", "X", "<p/>")).toEqual({ error: "invalid_title" });
  });
});
