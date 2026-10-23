import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubServer() {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/me") {
      return json(200, { signed_in: true, name: "editor1", roles: ["editor"] });
    }
    if (url.pathname === "/api/problems") return json(200, []);
    if (url.pathname === "/api/problems/abc/edit") {
      return json(200, {
        id: "abc",
        title: "Existing problem",
        description: "d",
        signature: "def f() -> int",
        tests: [],
      });
    }
    if (url.pathname === "/api/sessions/abc") return json(404, { error: "not_found" });
    return json(404, { error: "not_found" });
  });
  vi.stubGlobal("fetch", fn);
}

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App routing", () => {
  it("/ renders ProblemList", async () => {
    stubServer();
    renderRoute("/");

    expect(await screen.findByRole("heading", { name: "Problems" })).toBeTruthy();
  });

  it("/problems/new renders ProblemForm", async () => {
    stubServer();
    renderRoute("/problems/new");

    expect(await screen.findByRole("heading", { name: "New problem" })).toBeTruthy();
  });

  it("/problems/:id/edit renders ProblemForm in edit mode", async () => {
    stubServer();
    renderRoute("/problems/abc/edit");

    expect(await screen.findByRole("heading", { name: "Edit problem" })).toBeTruthy();
  });

  it("/s/:invite renders SessionPage", async () => {
    stubServer();
    renderRoute("/s/abc");

    expect(await screen.findByText("Session not found")).toBeTruthy();
  });
});
