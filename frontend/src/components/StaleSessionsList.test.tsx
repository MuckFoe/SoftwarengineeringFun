import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StaleSession } from "../api/types";
import { StaleSessionsList } from "./StaleSessionsList";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const rows: StaleSession[] = [
  {
    invite_id: "inv-new",
    problem_title: "Reverse list",
    stale_at: "2026-10-23T09:00:00Z",
    last_activity_at: "2026-10-16T09:00:00Z",
  },
  {
    invite_id: "inv-old",
    problem_title: "FizzBuzz",
    stale_at: "2026-10-20T12:00:00Z",
    last_activity_at: "2026-10-13T12:00:00Z",
  },
];

// The backend is not part of this unit; only the HTTP boundary is stubbed. The real
// round trip against the test stack is e2e/stale.spec.ts.
function stubServer(reactivateStatus = 200) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/sessions/stale") return new Response(JSON.stringify(rows), { status: 200 });
    if (url.endsWith("/reactivate") && init?.method === "POST") {
      return reactivateStatus === 200
        ? new Response(JSON.stringify({}), { status: 200 })
        : new Response(JSON.stringify({ error: "not_stale" }), { status: reactivateStatus });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function renderList() {
  render(
    <MemoryRouter>
      <StaleSessionsList now={() => NOW} />
    </MemoryRouter>,
  );
  await screen.findByRole("link", { name: /Reverse list/ });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StaleSessionsList", () => {
  it("lists each stale session with how long it has been stale, linking to it", async () => {
    stubServer();
    await renderList();
    expect(screen.getByRole("region", { name: "Stale sessions" })).toBeTruthy();
    const newer = screen.getByRole("link", { name: /Reverse list/ });
    expect(newer.getAttribute("href")).toBe("/s/inv-new");
    expect(newer.textContent).toMatch(/stale for 3 hours/);
    expect(screen.getByRole("link", { name: /FizzBuzz/ }).textContent).toMatch(/stale for 3 days/);
    expect(screen.getAllByRole("button", { name: /Reactivate/ })).toHaveLength(2);
  });

  // AC-10b (component part)
  it("Reactivate removes the row and confirms with a HUD", async () => {
    const fetchMock = stubServer();
    await renderList();
    fireEvent.click(screen.getByRole("button", { name: "Reactivate Reverse list" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: /Reverse list/ })).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("Session reactivated");
    expect(screen.getByRole("link", { name: /FizzBuzz/ })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/inv-new/reactivate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("also removes the row when the session was no longer stale (409)", async () => {
    stubServer(409);
    await renderList();
    fireEvent.click(screen.getByRole("button", { name: "Reactivate FizzBuzz" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: /FizzBuzz/ })).toBeNull());
  });

  it("keeps the row and says why when reactivation fails otherwise", async () => {
    stubServer(500);
    await renderList();
    fireEvent.click(screen.getByRole("button", { name: "Reactivate FizzBuzz" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("link", { name: /FizzBuzz/ })).toBeTruthy();
  });

  it("says so when nothing is stale", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    render(
      <MemoryRouter>
        <StaleSessionsList now={() => NOW} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("No stale sessions")).toBeTruthy();
  });
});
