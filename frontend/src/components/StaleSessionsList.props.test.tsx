import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StaleSession } from "../api/types";
import { StaleSessionsList } from "./StaleSessionsList";

const NOW = Date.parse("2026-10-23T12:00:00Z");
// GET /api/learn/sessions/stale names the lesson, not a problem (plan: lesson_title).
const rows: StaleSession[] = [
  {
    invite_id: "learn-inv",
    lesson_title: "Docker basics",
    stale_at: "2026-10-23T09:00:00Z",
    last_activity_at: "2026-09-23T09:00:00Z",
  },
];

// Only the HTTP boundary is stubbed; anything but the learn endpoints is a 404.
function stubServer() {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/learn/sessions/stale") {
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (url === "/api/learn/sessions/learn-inv/reactivate" && init?.method === "POST") {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StaleSessionsList with endpoint and sessionPath (FR-27)", () => {
  it("fetches the given endpoint and links rows under the given path", async () => {
    const fetchMock = stubServer();
    render(
      <MemoryRouter>
        <StaleSessionsList
          now={() => NOW}
          endpoint="/api/learn/sessions/stale"
          sessionPath="/learn/s/"
        />
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", { name: /Docker basics/ });
    expect(link.getAttribute("href")).toBe("/learn/s/learn-inv");
    expect(fetchMock).toHaveBeenCalledWith("/api/learn/sessions/stale", expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith("/api/sessions/stale", expect.anything());
  });

  it("reactivates through the same API family as the endpoint", async () => {
    const fetchMock = stubServer();
    render(
      <MemoryRouter>
        <StaleSessionsList
          now={() => NOW}
          endpoint="/api/learn/sessions/stale"
          sessionPath="/learn/s/"
        />
      </MemoryRouter>,
    );
    await screen.findByRole("link", { name: /Docker basics/ });
    fireEvent.click(screen.getByRole("button", { name: "Reactivate Docker basics" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: /Docker basics/ })).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/learn/sessions/learn-inv/reactivate",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
