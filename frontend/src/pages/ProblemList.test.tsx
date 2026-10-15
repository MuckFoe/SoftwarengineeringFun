import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProblemSummary } from "../api/types";
import { ProblemList } from "./ProblemList";

// Test double of the HTTP boundary only. Searching is the server's job, so the
// double answers each query the way the contract says the server would; the page
// is checked to render what the server returned for the query it sent.
const twoTargets: ProblemSummary = { id: "p-two", title: "Two targets", is_starter: true };
const reverseList: ProblemSummary = { id: "p-rev", title: "Reverse list", is_starter: true };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubServer() {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    if (method === "GET" && url.pathname === "/api/problems") {
      const q = url.searchParams.get("q") ?? "";
      if (q === "") return json(200, [twoTargets, reverseList]);
      if (q === "reverse") return json(200, [reverseList]);
      return json(200, []);
    }
    if (method === "POST" && url.pathname === "/api/sessions") {
      const body = JSON.parse(String(init?.body)) as { problem_id: string };
      if (body.problem_id === reverseList.id) return json(201, { invite_id: "inv-abc123" });
      return json(404, { error: "not_found" });
    }
    return json(404, { error: "not_found" });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function SessionMarker() {
  const { inviteId } = useParams();
  return <p>session page for {inviteId}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<ProblemList />} />
        <Route path="/s/:inviteId" element={<SessionMarker />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProblemList", () => {
  it("FR-5: searching 'reverse' lists only 'Reverse list'", async () => {
    const fetchFn = stubServer();
    renderPage();
    await screen.findByText("Two targets");

    fireEvent.change(screen.getByRole("searchbox", { name: /search/i }), {
      target: { value: "reverse" },
    });

    await waitFor(() => expect(screen.queryByText("Two targets")).toBeNull());
    expect(screen.getByText("Reverse list")).toBeTruthy();
    const urls = fetchFn.mock.calls.map(([input]) => String(input));
    expect(urls).toContain("/api/problems?q=reverse");
  });

  it("FR-11: 'start session' navigates to the returned invite", async () => {
    const fetchFn = stubServer();
    renderPage();
    await screen.findByText("Reverse list");

    fireEvent.click(screen.getByRole("button", { name: /start session.*reverse list/i }));

    await screen.findByText("session page for inv-abc123");
    const post = fetchFn.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post && String(post[0])).toBe("/api/sessions");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ problem_id: "p-rev" });
  });
});
