import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../api/types";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { LearnWindow } from "./LearnWindow";

// plan.md REST: GET /api/learn/topics → [{key, title, lessons: [{key, title, summary, step_count, minutes}]}]
const TOPICS = [
  {
    key: "git",
    title: "Git",
    lessons: [
      {
        key: "git/first-commit",
        title: "Your first commit",
        summary: "Stage a file and commit it.",
        step_count: 5,
        minutes: 10,
      },
      {
        key: "git/branches",
        title: "Branches",
        summary: "Create and switch branches.",
        step_count: 7,
        minutes: 15,
      },
    ],
  },
  {
    key: "shell",
    title: "The shell",
    lessons: [
      {
        key: "shell/navigation",
        title: "Moving around",
        summary: "cd, ls and pwd.",
        step_count: 1,
        minutes: 5,
      },
    ],
  },
];

const ADMIN: Me = { signed_in: true, name: "Ad", roles: ["admin"] };
const VISITOR: Me = { signed_in: false, roles: [] };

// The backend is not part of this unit; only the HTTP boundary is stubbed.
function stubServer(me: Me) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.pathname === "/api/me") return json(me);
    if (url.pathname === "/api/learn/topics" && method === "GET") return json(TOPICS);
    if (url.pathname === "/api/learn/sessions/stale") return json([]);
    if (url.pathname === "/api/sessions/stale") return json([]);
    if (url.pathname === "/api/learn/sessions" && method === "POST") {
      return json({ invite_id: "learn-inv1" }, 201);
    }
    return json({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function Where() {
  return <output aria-label="location">{useLocation().pathname}</output>;
}

async function renderWindow(me: Me = VISITOR) {
  const fetchMock = stubServer(me);
  render(
    <ShortcutsProvider>
      <MemoryRouter initialEntries={["/learn"]}>
        <Routes>
          <Route
            path="/learn"
            element={
              <>
                <LearnWindow />
                <Where />
              </>
            }
          />
          <Route path="/learn/s/:invite" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ShortcutsProvider>,
  );
  await screen.findByText("Moving around");
  return fetchMock;
}

const pathname = () => screen.getByRole("status", { name: "location" }).textContent;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LearnWindow", () => {
  it("AC-2: every lesson shows its title, summary, step count and duration", async () => {
    await renderWindow();
    for (const topic of TOPICS) {
      const section = screen.getByRole("region", { name: topic.title });
      for (const lesson of topic.lessons) {
        const item = within(section).getByRole("article", { name: lesson.title });
        expect(within(item).getByText(lesson.summary)).toBeTruthy();
        const steps = lesson.step_count === 1 ? "1 step" : `${lesson.step_count} steps`;
        expect(within(item).getByText(steps, { exact: false })).toBeTruthy();
        expect(within(item).getByText(`${lesson.minutes} min`, { exact: false })).toBeTruthy();
      }
    }
  });

  it("AC-6: Start session posts {lesson_key} and navigates to the returned invite", async () => {
    const fetchMock = await renderWindow();
    fireEvent.click(screen.getByRole("button", { name: "Start session: Branches" }));
    await waitFor(() => expect(pathname()).toBe("/learn/s/learn-inv1"));
    const post = fetchMock.mock.calls.find(
      ([input, init]) =>
        new URL(String(input), "http://localhost").pathname === "/api/learn/sessions" &&
        init?.method === "POST",
    );
    expect(post).toBeDefined();
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ lesson_key: "git/branches" });
  });

  it("shows an error when the session cannot be started", async () => {
    const fetchMock = await renderWindow();
    fetchMock.mockImplementationOnce(
      async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start session: Branches" }));
    expect(await screen.findByText("Could not start a session.")).toBeTruthy();
    expect(pathname()).toBe("/learn");
  });

  it("FR-1: the sidebar has the Areas navigation with Learn current", async () => {
    await renderWindow();
    expect(screen.getByRole("link", { name: "Learn" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Problems" })).toBeTruthy();
  });

  it("FR-27: an admin sees the stale learning sessions, from the learn endpoint", async () => {
    const fetchMock = await renderWindow(ADMIN);
    expect(await screen.findByText("Stale sessions")).toBeTruthy();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input]) =>
            new URL(String(input), "http://localhost").pathname === "/api/learn/sessions/stale",
        ),
      ).toBe(true),
    );
    expect(
      fetchMock.mock.calls.some(
        ([input]) => new URL(String(input), "http://localhost").pathname === "/api/sessions/stale",
      ),
    ).toBe(false);
  });

  it("FR-27: a non-admin does not see the stale list", async () => {
    const fetchMock = await renderWindow(VISITOR);
    expect(screen.queryByText("Stale sessions")).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/stale"))).toBe(false);
  });
});
