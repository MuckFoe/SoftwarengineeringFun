// Spec 018 task 44 (FR-10, FR-14, NFR-5, NFR-6): the problem picker's category and difficulty
// filters in the real app: signed in with text search, as a guest who joined by session link,
// keyboard only, at a narrow width, and the filter-to-list timing with 150 problems.
import type { Page } from "@playwright/test";
import { appUrl, expect, signIn, test } from "./fixtures";

const COUNT = (page: Page) => page.getByLabel("Result count");

async function chooseCategory(page: Page, label: string): Promise<void> {
  await page.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

/** The shown count once the list has loaded (the count reads "0 problems" until it does). */
async function loadedCount(page: Page): Promise<number> {
  await expect.poll(() => shownCount(page)).toBeGreaterThan(0);
  return shownCount(page);
}

async function shownCount(page: Page): Promise<number> {
  const text = (await COUNT(page).textContent()) ?? "";
  return Number.parseInt(text, 10);
}

/** Every listed row's category and difficulty cells, read from the table. */
function rowCells(page: Page): Promise<Array<{ category: string; difficulty: string }>> {
  return page.locator("main tbody tr:not([class*='groupRow'])").evaluateAll((rows) =>
    rows.map((r) => {
      const cells = r.querySelectorAll("td");
      return {
        category: cells[1]?.textContent?.trim() ?? "",
        difficulty: cells[2]?.textContent?.trim() ?? "",
      };
    }),
  );
}

async function useFilters(page: Page): Promise<void> {
  const all = await loadedCount(page);
  expect(all).toBeGreaterThanOrEqual(150);
  // No filter: category headings are shown (FR-11).
  await expect(page.getByRole("heading", { level: 2, name: "Strings" })).toBeVisible();

  await chooseCategory(page, "Strings");
  let rows = await rowCells(page);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.category === "Strings")).toBe(true);
  const strings = rows.length;

  await page.getByRole("button", { name: "Hard", exact: true }).click();
  rows = await rowCells(page);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThan(strings);
  expect(rows.every((r) => r.category === "Strings" && r.difficulty === "Hard")).toBe(true);

  // Text narrows further, or to nothing; either way every row matches all three.
  const first = (await page.locator("main tbody td").first().textContent()) ?? "";
  const word = first.trim().split(/\s+/)[0] ?? "";
  await page.getByRole("searchbox", { name: "Search problems" }).fill(word);
  rows = await rowCells(page);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.category === "Strings" && r.difficulty === "Hard")).toBe(true);
  const titles = await page.locator("main tbody td:first-child").allTextContents();
  expect(titles.every((t) => t.toLowerCase().includes(word.toLowerCase()))).toBe(true);

  // Nothing matches: the message and a way back (FR-12).
  await page.getByRole("searchbox", { name: "Search problems" }).fill("zzzz-no-such-problem");
  await expect(page.getByText("No problems match")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(COUNT(page)).toHaveText(`${all} problems`);
}

test("FR-10: signed in, category + difficulty + text combine and clear", async ({
  page,
  keycloak,
}) => {
  const u = keycloak.users.editor1;
  if (!u) throw new Error("no keycloak test user 'editor1'");
  await signIn(page, u.username, u.password, "/problems");
  await useFilters(page);
});

test("FR-14: a guest who joined by session link gets the same filters and grouping", async ({
  browser,
  keycloak,
}) => {
  const u = keycloak.users.editor1;
  if (!u) throw new Error("no keycloak test user 'editor1'");
  const host = await browser.newContext();
  const guest = await browser.newContext();
  try {
    const hostPage = await host.newPage();
    await signIn(hostPage, u.username, u.password, "/problems");
    const found = await hostPage.request.get(appUrl("/api/problems?q=Sum%20Two%20Numbers"));
    const list = (await found.json()) as Array<{ id: string; title: string }>;
    const problem = list.find((p) => p.title === "Sum Two Numbers");
    if (!problem) throw new Error("no seeded problem titled Sum Two Numbers");
    const created = await hostPage.request.post(appUrl("/api/sessions"), {
      data: { problem_id: problem.id },
    });
    expect(created.status()).toBe(201);
    const invite = ((await created.json()) as { invite_id: string }).invite_id;

    const page = await guest.newPage();
    await page.goto(appUrl(`/s/${invite}`));
    await page.getByLabel("Your name").fill("Gus");
    await page.getByRole("button", { name: "Join" }).click();
    await expect(page.locator(".cm-content")).toContainText("pass");

    await page.goto(appUrl("/problems"));
    await useFilters(page);
  } finally {
    await host.close();
    await guest.close();
  }
});

test("NFR-6: keyboard only, the filters are reachable and operable", async ({ page, keycloak }) => {
  const u = keycloak.users.editor1;
  if (!u) throw new Error("no keycloak test user 'editor1'");
  await signIn(page, u.username, u.password, "/problems");
  const all = await loadedCount(page);

  const category = page.getByRole("combobox", { name: "Category" });
  await category.focus();
  await expect(category).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox", { name: "Category" })).toBeVisible();
  // Down to the first real category, choose it with Enter; focus returns to the trigger.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(category).toBeFocused();
  await expect.poll(() => shownCount(page)).toBeLessThan(all);
  const rows = await rowCells(page);
  expect(new Set(rows.map((r) => r.category)).size).toBe(1);

  // Escape closes the list without changing the filter.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox", { name: "Category" }).getByRole("option", { selected: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Category" })).toHaveCount(0);
  await expect(category).toBeFocused();

  // Tab to the difficulty chips; Space toggles one, and its state is in its name/attributes.
  await page.keyboard.press("Tab");
  const easy = page.getByRole("button", { name: "Easy", exact: true });
  await expect(easy).toBeFocused();
  await page.keyboard.press("Space");
  await expect(easy).toHaveAttribute("aria-pressed", "true");
  expect((await rowCells(page)).every((r) => r.difficulty === "Easy")).toBe(true);
  await page.keyboard.press("Space");
  await expect(easy).toHaveAttribute("aria-pressed", "false");

  // Clear filters by keyboard restores the list.
  await page.getByRole("button", { name: "Clear filters" }).focus();
  await page.keyboard.press("Enter");
  await expect(COUNT(page)).toHaveText(`${all} problems`);
});

test("NFR-6: at 390 px the filters fit and nothing scrolls sideways", async ({
  page,
  keycloak,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const u = keycloak.users.editor1;
  if (!u) throw new Error("no keycloak test user 'editor1'");
  await signIn(page, u.username, u.password, "/problems");
  await loadedCount(page);
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noOverflow()).toBe(true);

  for (const name of ["Easy", "Medium", "Hard"]) {
    const chip = page.getByRole("button", { name, exact: true });
    await expect(chip).toBeVisible();
    const box = await chip.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  }
  await chooseCategory(page, "Strings");
  await page.getByRole("button", { name: "Hard", exact: true }).click();
  expect(await noOverflow()).toBe(true);
  expect((await rowCells(page)).length).toBeGreaterThan(0);
});

test("NFR-5: with 150 problems a filter choice shows its list within 200 ms (generous margin)", async ({
  page,
  keycloak,
}) => {
  const u = keycloak.users.editor1;
  if (!u) throw new Error("no keycloak test user 'editor1'");
  await signIn(page, u.username, u.password, "/problems");
  expect(await loadedCount(page)).toBeGreaterThanOrEqual(150);

  // From the click until the result count the user sees has changed, inside the page.
  const ms = await page.evaluate(async () => {
    const count = document.querySelector("output[aria-label='Result count']");
    const chip = [...document.querySelectorAll("button")].find((b) => b.textContent === "Hard");
    if (!count || !chip) throw new Error("filters not found");
    const before = count.textContent;
    return await new Promise<number>((resolve) => {
      const start = performance.now();
      new MutationObserver((_, obs) => {
        if (count.textContent !== before) {
          // Resolve after the next paint, so the list is on screen, not just in the DOM.
          requestAnimationFrame(() => {
            obs.disconnect();
            resolve(performance.now() - start);
          });
        }
      }).observe(count, { childList: true, characterData: true, subtree: true });
      chip.click();
    });
  });
  console.log(`NFR-5 measured filter -> updated list: ${ms.toFixed(1)} ms (target 200 ms)`);
  // 3x margin for a loaded CI machine.
  expect(ms).toBeLessThan(600);
});
