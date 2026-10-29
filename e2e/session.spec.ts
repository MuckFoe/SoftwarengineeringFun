// Spec 003 AC-11, AC-10, AC-3, AC-13: the session window's layout, switching problems from
// the sidebar, inline run feedback and the stale banner, in a real browser against the
// real stack.
import type { APIRequestContext, Page } from "@playwright/test";
import { appUrl, createSession, expect, markStale, signIn, test } from "./fixtures";

const FIRST = "Sum Two Numbers";

async function joinNewSession(page: Page, request: APIRequestContext): Promise<void> {
  const invite = await createSession(request, FIRST);
  await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill("Ada");
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
}

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Session" });

test("AC-11: sidebar with problems and participants, editor in main, toolbar actions, run panel toggles", async ({
  page,
  request,
}) => {
  await joinNewSession(page, request);

  const sidebar = page.getByRole("navigation", { name: "Sidebar" });
  await expect(sidebar.getByRole("region", { name: "Problems" })).toBeVisible();
  await expect(sidebar.getByRole("region", { name: "Participants" })).toContainText("Ada");
  await expect(page.getByRole("main").locator(".cm-content")).toBeVisible();
  for (const name of ["Run", "Invite", "Appearance"]) {
    await expect(toolbar(page).getByRole("button", { name, exact: true })).toBeVisible();
  }

  const panel = page.getByRole("region", { name: "Run results" });
  await expect(panel).toBeVisible();
  await toolbar(page).getByRole("button", { name: "Hide run results" }).click();
  await expect(panel).toHaveCount(0);
  await toolbar(page).getByRole("button", { name: "Show run results" }).click();
  await expect(panel).toBeVisible();
});

test("AC-10: picking another problem in the sidebar switches the session; no other switcher", async ({
  page,
  request,
}) => {
  await joinNewSession(page, request);
  const problems = page.getByRole("listbox", { name: "Problems" });
  const other = problems.getByRole("option").filter({ hasNotText: FIRST }).first();
  const otherTitle = (await other.textContent()) ?? "";
  expect(otherTitle).not.toBe("");

  await other.click();

  await expect(toolbar(page).getByRole("heading", { name: otherTitle })).toBeVisible();
  await expect(other).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
});

test("AC-3: Run shows a spinner within 100 ms, no dialog, and the result replaces it", async ({
  page,
  request,
}) => {
  await joinNewSession(page, request);
  const run = toolbar(page).getByRole("button", { name: "Run", exact: true });

  // Measured in the page: from the click to the first progressbar in the DOM.
  await page.evaluate(`(() => {
    window.__spinnerAfterMs = null;
    let clickedAt = null;
    document.addEventListener("click", () => { clickedAt = performance.now(); }, true);
    new MutationObserver(() => {
      if (clickedAt !== null && window.__spinnerAfterMs === null &&
          document.querySelector('[role="progressbar"]')) {
        window.__spinnerAfterMs = performance.now() - clickedAt;
      }
    }).observe(document.body, { childList: true, subtree: true });
  })()`);
  await run.click();

  await expect(page.getByRole("progressbar").first()).toBeAttached();
  const after = (await page.evaluate("window.__spinnerAfterMs")) as number | null;
  expect(after).not.toBeNull();
  expect(after ?? Number.POSITIVE_INFINITY).toBeLessThan(100);
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  const panel = page.getByRole("region", { name: "Run results" });
  await expect(panel.getByText(/^Test 1: /)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});

test("AC-13: a stale session shows the notice in view, with the editor and Run disabled", async ({
  page,
  request,
}) => {
  const invite = await createSession(request, FIRST);
  markStale(invite);
  await page.goto(appUrl(`/s/${invite}`));

  const banner = page.getByRole("status").filter({ hasText: /gone stale/ });
  await expect(banner).toBeInViewport();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  await expect(toolbar(page).getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reactivate" })).toHaveCount(0);
});

test("AC-13: an admin sees Reactivate in the banner, and reactivating re-enables editing", async ({
  page,
  request,
  keycloak,
}) => {
  const admin = keycloak.users.admin1;
  if (!admin) throw new Error("no keycloak test user 'admin1'");
  const invite = await createSession(request, FIRST);
  markStale(invite);
  await signIn(page, admin.username, admin.password, `/s/${invite}`);

  const banner = page.getByRole("status").filter({ hasText: /gone stale/ });
  await expect(banner).toBeInViewport();
  await banner.getByRole("button", { name: "Reactivate" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Session reactivated" })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await page.getByLabel("Your name").fill("Admin");
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  await expect(toolbar(page).getByRole("button", { name: "Run", exact: true })).toBeEnabled();
});
