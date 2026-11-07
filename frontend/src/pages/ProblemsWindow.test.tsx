import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me, ProblemSummary } from "../api/types";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { ProblemsWindow } from "./ProblemsWindow";

const TITLES = [
  "Sum two numbers",
  "Reverse list",
  "Reverse words",
  "FizzBuzz",
  "Two sum",
  "Palindrome check",
  "Merge intervals",
  "Valid parentheses",
  "Binary search",
  "Climbing stairs",
  "Rotate array",
  "Reverse integer",
];
const CATS = [
  "arrays",
  "strings",
  "strings",
  "math-bits",
  "arrays",
  "strings",
  "greedy-intervals",
  "stacks-queues",
  "sorting-searching",
  "dynamic-programming",
  "arrays",
  "math-bits",
];
const DIFFS = [
  "easy",
  "easy",
  "hard",
  "easy",
  "medium",
  "easy",
  "medium",
  "medium",
  "easy",
  "hard",
  "hard",
  "medium",
] as const;
const CATEGORIES = [
  { id: "arrays", label: "Arrays" },
  { id: "strings", label: "Strings" },
  { id: "stacks-queues", label: "Stacks & queues" },
  { id: "sorting-searching", label: "Sorting & searching" },
  { id: "dynamic-programming", label: "Dynamic programming" },
  { id: "math-bits", label: "Math & bit tricks" },
  { id: "greedy-intervals", label: "Greedy & intervals" },
];
const PROBLEMS: ProblemSummary[] = TITLES.map((title, i) => ({
  id: `p${i}`,
  title,
  is_starter: i < 3,
  category: CATS[i],
  difficulty: DIFFS[i],
}));

const EDITOR: Me = { signed_in: true, name: "Ed", roles: ["editor"], preferences: null };
const ADMIN: Me = { signed_in: true, name: "Ad", roles: ["admin"], preferences: null };

// The backend is not part of this unit; only the HTTP boundary is stubbed.
function stubServer(me: Me) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.pathname === "/api/me") return json(me);
    if (url.pathname === "/api/problems/categories") return json(CATEGORIES);
    if (url.pathname === "/api/problems" && (init?.method ?? "GET") === "GET")
      return json(PROBLEMS);
    if (url.pathname === "/api/sessions/stale") return json([]);
    if (url.pathname === "/api/sessions" && init?.method === "POST") {
      return json({ invite_id: "inv1" }, 201);
    }
    return json({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function Where() {
  return <output aria-label="location">{useLocation().pathname}</output>;
}

async function renderWindow(me: Me = EDITOR, props: Parameters<typeof ProblemsWindow>[0] = {}) {
  stubServer(me);
  render(
    <ShortcutsProvider>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <ProblemsWindow {...props} />
                <Where />
              </>
            }
          />
          <Route path="/s/:invite" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ShortcutsProvider>,
  );
  await screen.findByRole("cell", { name: "Rotate array" });
}

// Data rows only: not the header row and not the category heading rows.
const rows = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .filter((r) => r.querySelector("td"));
const titles = () => rows().map((r) => r.querySelector("td")?.textContent);
const pathname = () => screen.getByRole("status", { name: "location" }).textContent;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProblemsWindow", () => {
  it("is a window: sidebar, toolbar with search, appearance and account, and a problem table", async () => {
    await renderWindow();
    expect(screen.getByRole("navigation", { name: "Sidebar" })).toBeTruthy();
    const toolbar = screen.getByRole("toolbar", { name: "Problems" });
    expect(within(toolbar).getByRole("searchbox", { name: "Search problems" })).toBeTruthy();
    expect(within(toolbar).getByRole("button", { name: "Appearance" })).toBeTruthy();
    expect(within(toolbar).getByRole("link", { name: "Ed" })).toBeTruthy();
    expect(rows()).toHaveLength(12);
  });

  // AC-12
  it("narrows the list on every keystroke", async () => {
    await renderWindow();
    const search = screen.getByRole("searchbox", { name: "Search problems" });
    const counts: number[] = [];
    let typed = "";
    for (const ch of "rev") {
      typed += ch;
      fireEvent.change(search, { target: { value: typed } });
      counts.push(rows().length);
    }
    // "r" matches 10 titles, "re" 4, "rev" 3.
    expect(counts).toEqual([10, 4, 3]);
    expect(rows().map((r) => r.querySelector("th, td")?.textContent)).toEqual([
      "Reverse list",
      "Reverse words",
      "Reverse integer",
    ]);
  });

  it("filters to starter problems from the sidebar", async () => {
    await renderWindow();
    fireEvent.click(screen.getByRole("option", { name: "Starter problems" }));
    expect(rows()).toHaveLength(3);
  });

  // AC-2 (component part)
  it("opens New problem as a sheet over the list without navigating", async () => {
    await renderWindow();
    fireEvent.click(screen.getByRole("button", { name: "New problem" }));
    expect(screen.getByRole("dialog", { name: "New problem" })).toBeTruthy();
    expect(pathname()).toBe("/");
    expect(rows()).toHaveLength(12);
  });

  it("opens Edit as a sheet for that problem", async () => {
    await renderWindow();
    fireEvent.click(screen.getByRole("button", { name: "Edit FizzBuzz" }));
    expect(screen.getByRole("dialog", { name: "Edit problem" })).toBeTruthy();
    expect(pathname()).toBe("/");
  });

  it("opens with a sheet already open for a deep link", async () => {
    await renderWindow(EDITOR, { initialSheet: { mode: "new" } });
    expect(screen.getByRole("dialog", { name: "New problem" })).toBeTruthy();
    expect(rows()).toHaveLength(12);
  });

  it("starts a session and goes to it", async () => {
    await renderWindow();
    fireEvent.click(screen.getByRole("button", { name: "Start session: FizzBuzz" }));
    await waitFor(() => expect(pathname()).toBe("/s/inv1"));
  });

  it("spec 012 FR-1: signed in, starting a session goes straight to it, with no name prompt", async () => {
    await renderWindow({ signed_in: true, name: "newuser", roles: [], preferences: null });
    fireEvent.click(screen.getByRole("button", { name: "Start session: FizzBuzz" }));
    await waitFor(() => expect(pathname()).toBe("/s/inv1"));
    expect(screen.queryByLabelText("Your name")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers no New problem or Edit to someone who isn't an editor", async () => {
    await renderWindow(ADMIN);
    expect(screen.queryByRole("button", { name: "New problem" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit FizzBuzz" })).toBeNull();
  });

  // FR-9
  it("shows Stale sessions to an admin only", async () => {
    await renderWindow(ADMIN);
    expect(await screen.findByRole("region", { name: "Stale sessions" })).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    await renderWindow(EDITOR);
    expect(screen.queryByRole("region", { name: "Stale sessions" })).toBeNull();
  });

  it("focuses search, opens New problem and toggles the sidebar by shortcut", async () => {
    await renderWindow();
    fireEvent.keyDown(window, { key: "f", code: "KeyF", ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Search problems" }));

    fireEvent.keyDown(window, { key: "s", code: "KeyS", ctrlKey: true, altKey: true });
    expect(screen.queryByRole("navigation", { name: "Sidebar" })).toBeNull();
    fireEvent.keyDown(window, { key: "s", code: "KeyS", ctrlKey: true, altKey: true });
    expect(screen.getByRole("navigation", { name: "Sidebar" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "n", code: "KeyN", ctrlKey: true, altKey: true });
    expect(screen.getByRole("dialog", { name: "New problem" })).toBeTruthy();
  });

  // FR-9
  it("shows each problem's difficulty and category in its row", async () => {
    await renderWindow();
    const row = rows().find((r) => r.textContent?.includes("Two sum"));
    expect(row?.textContent).toContain("Arrays");
    expect(row?.textContent).toContain("Medium");
  });

  // FR-11
  it("groups by category under headings, keeping each group's order, when unfiltered", async () => {
    await renderWindow();
    const headings = within(screen.getByRole("table"))
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual([
      "Arrays",
      "Strings",
      "Stacks & queues",
      "Sorting & searching",
      "Dynamic programming",
      "Math & bit tricks",
      "Greedy & intervals",
    ]);
    expect(titles().slice(0, 3)).toEqual(["Sum two numbers", "Two sum", "Rotate array"]);
  });

  // FR-10
  it("narrows by category, then difficulty, then search, each on top of the last", async () => {
    await renderWindow();
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(screen.getByRole("option", { name: "Strings" }));
    expect(titles()).toEqual(["Reverse list", "Reverse words", "Palindrome check"]);
    expect(within(screen.getByRole("table")).queryAllByRole("heading")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Easy" }));
    expect(screen.getByRole("button", { name: "Easy" }).getAttribute("aria-pressed")).toBe("true");
    expect(titles()).toEqual(["Reverse list", "Palindrome check"]);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search problems" }), {
      target: { value: "pal" },
    });
    expect(titles()).toEqual(["Palindrome check"]);
  });

  // FR-12
  it("says nothing matches and clears the filters from the empty state", async () => {
    await renderWindow();
    fireEvent.click(screen.getByRole("button", { name: "Hard" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search problems" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No problems match")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rows()).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Hard" }).getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });

  // NFR-6
  it("announces the result count politely", async () => {
    await renderWindow();
    const live = screen.getByRole("status", { name: "Result count" });
    expect(live.textContent).toBe("12 problems");
    fireEvent.click(screen.getByRole("button", { name: "Hard" }));
    expect(live.textContent).toBe("3 problems");
  });

  // FR-14
  it("shows the same filters to someone who is not signed in", async () => {
    await renderWindow({ signed_in: false, name: "", roles: [], preferences: null } as Me);
    expect(screen.getByRole("combobox", { name: "Category" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Difficulty" })).toBeTruthy();
  });
});
