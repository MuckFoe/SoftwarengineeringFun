// Spec 003 AC-10b / FR-9: an admin reactivates a stale session from the "Stale sessions"
// sidebar section; it leaves the list and the session is active again. Runs against the
// real stack: a session is created through the API and marked stale in its database.
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PROBLEM_TITLE = "Sum Two Numbers";

async function createSession(request: APIRequestContext): Promise<string> {
  const found = await request.get(`/api/problems?q=${encodeURIComponent(PROBLEM_TITLE)}`);
  const problems = (await found.json()) as Array<{ id: string; title: string }>;
  const problem = problems.find((p) => p.title === PROBLEM_TITLE);
  if (!problem) throw new Error(`no seeded problem titled ${PROBLEM_TITLE}`);
  const created = await request.post("/api/sessions", { data: { problem_id: problem.id } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { invite_id: string }).invite_id;
}

/** Marks the session stale in the stack's database, as the stale-session job would. */
function markStale(invite: string): void {
  if (!/^[\w-]+$/.test(invite)) throw new Error(`unexpected invite id ${invite}`);
  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      "docker-compose.yml",
      "exec",
      "-T",
      "db",
      "sh",
      "-c",
      `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "update session set stale_at = now() where invite_id = '${invite}'"`,
    ],
    { cwd: REPO_ROOT, stdio: "pipe" },
  );
}

async function signIn(page: Page, username: string, password: string, next = "/"): Promise<void> {
  await page.goto(`/api/auth/login?next=${encodeURIComponent(next)}`);
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await page.waitForURL((url) => url.pathname === next);
}

test("AC-10b: the stale endpoint lists the stale session for an admin until it is reactivated", async ({
  page,
  request,
  keycloak,
}) => {
  const admin = keycloak.users.admin1;
  if (!admin) throw new Error("no keycloak test user 'admin1'");
  const invite = await createSession(request);
  markStale(invite);
  await signIn(page, admin.username, admin.password);

  const listed = async () =>
    (
      (await (await page.request.get("/api/sessions/stale")).json()) as Array<{ invite_id: string }>
    ).map((s) => s.invite_id);
  expect(await listed()).toContain(invite);
  expect((await page.request.post(`/api/sessions/${invite}/reactivate`)).status()).toBe(200);
  expect(await listed()).not.toContain(invite);
  expect((await request.get(`/api/sessions/${invite}`)).status()).toBe(200);
});

test("AC-10b: Reactivate in the sidebar removes the row and the session is active", async ({
  page,
  request,
  keycloak,
}) => {
  const admin = keycloak.users.admin1;
  if (!admin) throw new Error("no keycloak test user 'admin1'");
  const invite = await createSession(request);
  markStale(invite);
  await signIn(page, admin.username, admin.password);

  const section = page.getByRole("region", { name: "Stale sessions" });
  const link = section.locator(`a[href="/s/${invite}"]`);
  await expect(link).toBeVisible();
  await section
    .getByRole("listitem")
    .filter({ has: page.locator(`a[href="/s/${invite}"]`) })
    .getByRole("button", { name: /^Reactivate/ })
    .click();

  await expect(page.getByRole("status").filter({ hasText: "Session reactivated" })).toBeVisible();
  await expect(link).toHaveCount(0);
  expect((await request.get(`/api/sessions/${invite}`)).status()).toBe(200);
});
